import { STATS, bst, typesIn, isDamaging } from './data';
import type { Generation, StatKey, TypeName } from './data';
import { defensiveMultiplier, moveMultiplier, typeMultiplier } from './types';
import type { Member } from './types';

// ---------- Defense ----------

export interface DefenseRow {
  type: TypeName;
  /** Damage multiplier per team member (same order as the team). */
  perMember: number[];
  weak: number;
  resist: number;
  immune: number;
}

export function defenseTable(gen: Generation, team: Member[]): DefenseRow[] {
  return typesIn(gen).map((type) => {
    const perMember = team.map((m) => defensiveMultiplier(gen, m, type));
    return {
      type,
      perMember,
      weak: perMember.filter((x) => x > 1).length,
      resist: perMember.filter((x) => x > 0 && x < 1).length,
      immune: perMember.filter((x) => x === 0).length,
    };
  });
}

// ---------- Offense ----------

export interface CoverageSource {
  member: number;
  move?: string;
  attackType: TypeName;
  multiplier: number;
  /** True when no damaging move is chosen and the member's own types stand in as STAB. */
  assumed: boolean;
}

export interface CoverageRow {
  type: TypeName;
  best: number;
  sources: CoverageSource[];
}

/** Attack options per member: chosen damaging moves, or STAB types when none are chosen yet. */
function attackOptions(m: Member): { type: TypeName; move?: import('./data').Move; assumed: boolean }[] {
  const dmg = m.moves.filter(isDamaging);
  if (dmg.length) return dmg.map((mv) => ({ type: mv.type, move: mv, assumed: false }));
  return m.species.types.map((type) => ({ type, assumed: true }));
}

export function coverageTable(gen: Generation, team: Member[]): CoverageRow[] {
  return typesIn(gen).map((type) => {
    const sources: CoverageSource[] = [];
    team.forEach((m, i) => {
      for (const o of attackOptions(m)) {
        const multiplier = o.move
          ? moveMultiplier(gen, o.move, [type])
          : typeMultiplier(gen, o.type, [type]);
        if (multiplier > 1) {
          sources.push({ member: i, move: o.move?.name, attackType: o.type, multiplier, assumed: o.assumed });
        }
      }
    });
    const best = team.length ? Math.max(0, ...team.flatMap((m) =>
      attackOptions(m).map((o) => (o.move ? moveMultiplier(gen, o.move, [type]) : typeMultiplier(gen, o.type, [type]))),
    )) : 0;
    return { type, best, sources };
  });
}

// ---------- Stats ----------

export type Role = 'Physical attacker' | 'Special attacker' | 'Mixed attacker' | 'Wall' | 'Bulky attacker';

export interface MemberStats {
  bst: number;
  attack: number;
  bulk: number;
  speed: number;
  role: Role;
}

export function memberStats(m: Member): MemberStats {
  const b = m.species.baseStats;
  const attack = Math.max(b.atk, b.spa);
  const bulk = b.hp + b.def + b.spd;
  let role: Role;
  if (attack < 80 && bulk >= 270) role = 'Wall';
  else if (Math.abs(b.atk - b.spa) <= 15 && attack >= 90) role = 'Mixed attacker';
  else if (bulk >= 300 && attack < 110) role = 'Bulky attacker';
  else role = b.atk > b.spa ? 'Physical attacker' : 'Special attacker';
  return { bst: bst(m.species), attack, bulk, speed: b.spe, role };
}

export function teamAverages(team: Member[]): Record<StatKey, number> {
  const out = {} as Record<StatKey, number>;
  for (const s of STATS) out[s] = team.length ? team.reduce((a, m) => a + m.species.baseStats[s], 0) / team.length : 0;
  return out;
}

// ---------- Insights ----------

export interface Insight {
  level: 'bad' | 'warn' | 'good';
  text: string;
}

export function insights(gen: Generation, team: Member[]): Insight[] {
  if (!team.length) return [];
  const out: Insight[] = [];
  const def = defenseTable(gen, team);
  for (const r of def) {
    const cover = r.resist + r.immune;
    if (r.weak >= 3 || (r.weak >= 2 && cover === 0)) {
      out.push({ level: 'bad', text: `${r.weak} members are weak to ${r.type} and ${cover ? `only ${cover} resist${cover === 1 ? 's' : ''} it` : 'none resist it'}.` });
    } else if (r.weak > cover + 1) {
      out.push({ level: 'warn', text: `Weakness to ${r.type} outweighs resistances (${r.weak} weak vs ${cover}).` });
    }
  }
  const gaps = coverageTable(gen, team).filter((r) => r.best <= 1).map((r) => r.type);
  if (gaps.length) out.push({ level: 'warn', text: `Nothing hits ${gaps.join(', ')} super effectively.` });
  else out.push({ level: 'good', text: 'Every type is hit super effectively by at least one attack.' });

  const stats = team.map(memberStats);
  const phys = team.filter((m) => m.species.baseStats.atk > m.species.baseStats.spa + 15).length;
  const spec = team.filter((m) => m.species.baseStats.spa > m.species.baseStats.atk + 15).length;
  if (team.length >= 4 && (phys === 0 || spec === 0)) {
    out.push({ level: 'warn', text: `Team is all-${phys ? 'physical' : 'special'}: walls of the other kind will stall it.` });
  }
  if (team.length >= 4 && !stats.some((s) => s.speed >= 100)) {
    out.push({ level: 'warn', text: 'No member has base Speed 100 or higher.' });
  }
  if (!out.some((i) => i.level !== 'good')) out.push({ level: 'good', text: 'No glaring weaknesses found.' });
  return out;
}

// ---------- Team report ----------

export interface TeamReport {
  typeCount: number;
  /** Types where resistances and immunities at least match the weaknesses. */
  defenseSafe: number;
  /** Types the team can hit super effectively. */
  offenseHit: number;
  /** Members with base Speed of 95 or more. */
  fast: number;
  avgSpeed: number;
  physical: number;
  special: number;
  mixed: number;
  /** Weaknesses shared by two or more members that resistances do not offset, worst first. */
  sharedWeak: { type: TypeName; weak: number; cover: number }[];
}

export function teamReport(gen: Generation, team: Member[]): TeamReport {
  const def = defenseTable(gen, team);
  const cov = coverageTable(gen, team);
  const side = (m: Member) => {
    const b = m.species.baseStats;
    return b.atk > b.spa + 15 ? 'p' : b.spa > b.atk + 15 ? 's' : 'm';
  };
  return {
    typeCount: def.length,
    defenseSafe: def.filter((r) => r.weak <= r.resist + r.immune).length,
    offenseHit: cov.filter((r) => r.best > 1).length,
    fast: team.filter((m) => m.species.baseStats.spe >= 95).length,
    avgSpeed: team.length ? Math.round(team.reduce((a, m) => a + m.species.baseStats.spe, 0) / team.length) : 0,
    physical: team.filter((m) => side(m) === 'p').length,
    special: team.filter((m) => side(m) === 's').length,
    mixed: team.filter((m) => side(m) === 'm').length,
    sharedWeak: def
      .filter((r) => r.weak >= 2 && r.weak > r.resist + r.immune)
      .map((r) => ({ type: r.type, weak: r.weak, cover: r.resist + r.immune }))
      .sort((a, b) => b.weak - b.cover - (a.weak - a.cover)),
  };
}
