import { learnableMoves } from './data';
import type { Generation, Move, Specie, TypeName } from './data';
import { pickAttacks } from './moves';
import { ROLE_BY_ID, moveRoles } from './roles';
import type { RoleId } from './roles';
import type { Feat, Weights } from './optimize';

export interface TeamSetOptions {
  /** Defending types of the opposing Pokémon, to aim coverage at. */
  foes?: TypeName[][];
  /** Existing moves per member. Members with moves here are left alone, but their roles count towards the team. */
  keep?: (string[] | null | undefined)[];
}

interface Profile {
  bulk: number;
  attack: number;
  speed: number;
  physical: boolean;
}

const profile = (s: Specie): Profile => {
  const b = s.baseStats;
  return { bulk: b.hp + b.def + b.spd, attack: Math.max(b.atk, b.spa), speed: b.spe, physical: b.atk >= b.spa };
};

/** Preferred moves for a role, best first. Later entries are only used when earlier ones cannot be learned. */
const PREFERENCE: Partial<Record<RoleId, string[]>> = {
  hazards: ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'],
  removal: ['rapidspin', 'defog', 'courtchange', 'mortalspin', 'tidyup'],
  speed: ['trickroom', 'tailwind', 'thunderwave', 'icywind', 'glare', 'electroweb', 'stickyweb'],
  recovery: ['recover', 'roost', 'softboiled', 'slackoff', 'synthesis', 'moonlight', 'morningsun', 'shoreup', 'wish', 'milkdrink'],
  pivot: ['uturn', 'voltswitch', 'flipturn', 'partingshot', 'teleport', 'chillyreception'],
  setup: ['swordsdance', 'dragondance', 'nastyplot', 'quiverdance', 'calmmind', 'bulkup', 'shellsmash', 'tailglow', 'coil', 'bellydrum'],
};

/** At most one Pokémon should carry each of these; others duplicating them is wasted space. */
const ONE_PER_TEAM = new Set<RoleId>(['hazards', 'removal']);

/** How well a member suits a role (higher is better). Negative means "do not use for this". */
function fit(role: RoleId, p: Profile, m: Move): number {
  switch (role) {
    case 'hazards':
    case 'removal':
      return p.bulk / 8 - p.attack / 5;
    case 'recovery':
      return p.bulk >= 250 || p.attack < 100 ? p.bulk / 6 + (100 - Math.min(100, p.attack)) / 4 : -1;
    case 'speed':
      if (m.pseudoWeather === 'trickroom') return (110 - p.speed) / 3 + p.bulk / 20;
      return p.speed / 4 + p.bulk / 20;
    case 'pivot': {
      const attackingPivot = m.category !== 'Status';
      const sameSide = (m.category === 'Physical') === p.physical;
      return (attackingPivot ? (sameSide ? 12 : 4) : 6) + p.speed / 10 + p.bulk / 30;
    }
    case 'setup': {
      const boostsPhysical = (m.boosts?.atk ?? 0) > 0 || m.id === 'bellydrum' || m.id === 'shellsmash';
      const boostsSpecial = (m.boosts?.spa ?? 0) > 0 || m.id === 'shellsmash';
      if (p.attack < 90 || !((p.physical && boostsPhysical) || (!p.physical && boostsSpecial))) return -1;
      return p.attack / 3 + p.speed / 6 + p.bulk / 25;
    }
    default:
      return 0;
  }
}

const TARGETS: { role: RoleId; count: number }[] = [
  { role: 'hazards', count: 1 },
  { role: 'removal', count: 1 },
  { role: 'speed', count: 1 },
  { role: 'recovery', count: 2 },
  { role: 'pivot', count: 1 },
  { role: 'setup', count: 2 },
];

const MAX_UTILITY = 2;

/**
 * Full movesets for a team. Support jobs (hazards, removal, speed control, recovery, pivoting, setup) are handed
 * to the members who suit them and can learn a fitting move, one job at a time so the team does not end up with
 * five Stealth Rocks and no Recovery; every member then gets attacking moves for the remaining slots. A Pokémon
 * never carries more than two support moves, so it always keeps at least two attacks.
 */
export async function buildTeamSets(gen: Generation, team: Specie[], opts: TeamSetOptions = {}): Promise<string[][]> {
  const learn = await Promise.all(team.map((s) => learnableMoves(gen, s.name)));
  const byId = (i: number) => new Map(learn[i].map((m) => [m.id as string, m]));
  const lookups = team.map((_, i) => byId(i));
  const profiles = team.map(profile);

  const fixed = team.map((_, i) => !!opts.keep?.[i]?.length);
  const utility: Move[][] = team.map(() => []);
  const attacks: Move[][] = team.map((_, i) =>
    fixed[i] ? opts.keep![i]!.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; }) : [],
  );

  const holders = (role: RoleId) =>
    team.filter((_, i) => [...utility[i], ...(fixed[i] ? attacks[i] : [])].some((m) => moveRoles(m).includes(role))).length;
  const taken = new Set<string>(attacks.flatMap((ms, i) => (fixed[i] ? ms.map((m) => m.id as string) : [])));

  for (const { role, count } of TARGETS) {
    while (holders(role) < count) {
      let best: { i: number; move: Move; score: number } | undefined;
      team.forEach((_, i) => {
        if (fixed[i] || utility[i].length >= MAX_UTILITY) return;
        // Setup suits attackers; leave support jobs to the others when possible.
        const prefs = PREFERENCE[role] ?? [];
        prefs.forEach((id, rank) => {
          const move = lookups[i].get(id);
          // Judge the move by this generation's data: Teleport only pivots from Gen 8, for example.
          if (!move || !moveRoles(move).includes(role) || taken.has(move.id) || utility[i].some((u) => u.id === move.id)) return;
          const f = fit(role, profiles[i], move);
          if (f < 0) return;
          // Earlier preferences win unless a much better-suited member only has a later one.
          const score = f + (prefs.length - rank) * 3 - utility[i].length * 6;
          if (!best || score > best.score) best = { i, move, score };
        });
      });
      if (!best) break;
      utility[best.i].push(best.move);
      if (ONE_PER_TEAM.has(role)) taken.add(best.move.id);
    }
  }

  return team.map((s, i) => {
    if (fixed[i]) return attacks[i].map((m) => m.name);
    const atk = pickAttacks(gen, s, learn[i], 4 - utility[i].length, opts.foes);
    return [...atk, ...utility[i]].map((m) => m.name);
  });
}

// ---------- Role awareness for the optimizer ----------

const ASSIGNABLE = TARGETS.map((t) => t.role);

/** The support roles each Pokémon could actually fill: it learns a fitting move and its stats suit the job. */
export async function roleCapabilities(gen: Generation, species: Specie[]): Promise<Map<string, RoleId[]>> {
  const out = new Map<string, RoleId[]>();
  for (const s of species) {
    if (out.has(s.name)) continue;
    const moves = new Map((await learnableMoves(gen, s.name)).map((m) => [m.id as string, m]));
    const p = profile(s);
    const roles = ASSIGNABLE.filter((role) =>
      (PREFERENCE[role] ?? []).some((id) => {
        const m = moves.get(id);
        return !!m && moveRoles(m).includes(role) && fit(role, p, m) >= 0;
      }),
    );
    out.set(s.name, roles);
  }
  return out;
}

/** Worth of the support jobs a team can cover when each member takes at most two of them. */
export function roleBonus(capabilities: RoleId[][]): number {
  const used = capabilities.map(() => 0);
  const order = [...ASSIGNABLE].sort((a, b) => ROLE_BY_ID[b].weight - ROLE_BY_ID[a].weight);
  let total = 0;
  for (const role of order) {
    const info = ROLE_BY_ID[role];
    const candidates = capabilities
      .map((caps, i) => ({ i, n: caps.length, ok: caps.includes(role) && used[i] < MAX_UTILITY }))
      .filter((c) => c.ok)
      .sort((a, b) => a.n - b.n); // specialists first, so flexible Pokémon stay free for other jobs
    for (const c of candidates.slice(0, info.cap)) {
      used[c.i]++;
      total += info.weight;
    }
  }
  return total;
}

/** Add the role bonus (scaled by `weights.roles`) to any team objective. */
export function withRoles(
  objective: (feats: Feat[]) => { total: number; parts: Weights },
  capabilities: Map<string, RoleId[]>,
  roleWeight: number,
) {
  const SCALE = 2.5;
  return (feats: Feat[]) => {
    const base = objective(feats);
    if (roleWeight <= 0) return base;
    const bonus = roleBonus(feats.map((f) => capabilities.get(f.s.name) ?? [])) * SCALE * roleWeight;
    return { total: base.total + bonus, parts: { ...base.parts, roles: bonus } };
  };
}
