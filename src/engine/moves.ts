import { learnableMoves, typesIn } from './data';
import type { Generation, Move, Specie, TypeName } from './data';
import { moveMultiplier } from './types';

const risky = (m: Move) =>
  !!(m.flags.recharge || m.flags.charge || m.selfdestruct || m.ohko || m.mindBlownRecoil || m.id === 'focuspunch' ||
    m.id === 'dreameater' || m.id === 'fakeout' || m.id === 'firstimpression' || m.id === 'lastresort' || m.id === 'steelroller' ||
    m.id === 'belch' || m.id === 'upperhand' || m.id === 'suckerpunch' || m.id === 'poltergeist' || m.id === 'spitup');

const selfDrop = (m: Move) => {
  const b = m.self?.boosts;
  return !!b && Object.values(b).some((v) => (v ?? 0) < 0);
};

function power(m: Move, s: Specie): number {
  const acc = m.accuracy === true ? 1 : m.accuracy / 100;
  const stab = s.types.includes(m.type) ? 1.5 : 1;
  const wantPhysical = s.baseStats.atk >= s.baseStats.spa;
  const side = (m.category === 'Physical') === wantPhysical ? 1 : 0.45;
  return m.basePower * acc * stab * side * (selfDrop(m) ? 0.8 : 1) * (m.priority > 0 ? 1.05 : 1);
}

/**
 * Choose up to `count` reliable attacking moves from `all`: the best STAB move for each own type first, then the
 * moves that open the most new super-effective coverage. When `foes` (the defending types of each opposing Pokémon)
 * is given, coverage is measured against those targets instead of every single type.
 */
export function pickAttacks(gen: Generation, species: Specie, all: Move[], count: number, foes?: TypeName[][]): Move[] {
  const pool = all.filter((m) => m.category !== 'Status' && m.basePower >= 40 && !risky(m));
  const targets: TypeName[][] = foes?.length ? foes : typesIn(gen).map((t) => [t]);
  const chosen: Move[] = [];

  for (const t of species.types) {
    if (chosen.length >= count) break;
    const best = pool.filter((m) => m.type === t).sort((a, b) => power(b, species) - power(a, species))[0];
    if (best && power(best, species) >= 40) chosen.push(best);
  }

  const hits = (m: Move) => new Set<number>(targets.flatMap((t, i) => (moveMultiplier(gen, m, t) > 1 ? [i] : [])));
  while (chosen.length < count) {
    const covered = new Set<number>();
    chosen.forEach((m) => hits(m).forEach((t) => covered.add(t)));
    let best: Move | undefined;
    let bestVal = 0;
    for (const m of pool) {
      if (chosen.includes(m) || chosen.some((c) => c.type === m.type)) continue;
      const gain = [...hits(m)].filter((t) => !covered.has(t)).length;
      const val = gain * 18 + power(m, species) / 8;
      if (val > bestVal) { bestVal = val; best = m; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

/** Four attacking moves for one Pokémon (see `pickAttacks`). Status moves are left to `buildTeamSets`. */
export async function autoMoves(gen: Generation, species: Specie, foes?: TypeName[][]): Promise<string[]> {
  const all = await learnableMoves(gen, species.name);
  return pickAttacks(gen, species, all, 4, foes).map((m) => m.name);
}

/** Attack types a Pokémon is likely to use: the types of its best attacking moves (STAB if it has none). */
export async function likelyAttackTypes(gen: Generation, species: Specie): Promise<TypeName[]> {
  const names = await autoMoves(gen, species);
  const types = new Set<TypeName>(names.flatMap((n) => {
    const m = gen.moves.get(n);
    return m ? [m.type] : [];
  }));
  return types.size ? [...types] : [...species.types];
}

/** The distinct attack types of a list of move names (the Pokémon's own types when none are known). */
export function moveTypesOf(gen: Generation, names: string[], species: Specie): TypeName[] {
  const types = new Set<TypeName>(names.flatMap((n) => {
    const m = gen.moves.get(n);
    return m ? [m.type] : [];
  }));
  return types.size ? [...types] : [...species.types];
}
