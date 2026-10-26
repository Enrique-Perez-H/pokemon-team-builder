import { typesIn } from './data';
import type { Generation, Specie, TypeName } from './data';
import { defensiveMultiplier } from './types';
import type { Member } from './types';
import { DEFAULT_WEIGHTS, scoreFeats } from './optimize';
import type { Feat, Weights } from './optimize';
import { bst, isDamaging, speciesPool } from './data';
import { speciesViolations } from './rules';
import type { RuleInstance } from './rules';

/** An opposing Pokémon: what it is and which attack types it is expected to use. */
export interface Foe {
  species: Specie;
  attackTypes: TypeName[];
  ability?: string;
}

/** The minimal description of one of our Pokémon needed to judge a matchup. */
export interface Fighter {
  attackTypes: TypeName[];
  defMult: (atk: TypeName) => number;
  spe: number;
  bst: number;
}

export interface Matchup {
  /** Higher is better for us; roughly -6..+6. */
  score: number;
  /** log2 of our best multiplier against the foe (-2 when immune). */
  off: number;
  /** -log2 of the foe's best multiplier against us (+2 when we are immune to everything it has). */
  def: number;
  speed: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * 1v1 matchup on types, speed and raw power: do we hit it harder than it hits us, and who moves first.
 * This is a screening heuristic, not a damage calculation.
 */
export function matchup(gen: Generation, me: Fighter, foe: Foe): Matchup {
  const foeMember: Member = { species: foe.species, ability: foe.ability, moves: [] };
  let o = 0;
  for (const t of me.attackTypes) o = Math.max(o, defensiveMultiplier(gen, foeMember, t));
  let d = 0;
  for (const t of foe.attackTypes) d = Math.max(d, me.defMult(t));
  const off = o === 0 ? -2 : clamp(Math.log2(o), -2, 2);
  const def = d === 0 ? 2 : clamp(-Math.log2(d), -2, 2);
  const speed = me.spe > foe.species.baseStats.spe ? 0.5 : me.spe < foe.species.baseStats.spe ? -0.5 : 0;
  const power = clamp((me.bst - bst(foe.species)) / 200, -1, 1);
  return { score: off + def + speed + power, off, def, speed };
}

/** Our current Pokémon as fighters: chosen damaging moves, or their own types when none are chosen. */
export function fighterFromMember(gen: Generation, m: Member): Fighter {
  const dmg = m.moves.filter(isDamaging).map((mv) => mv.type);
  return {
    attackTypes: dmg.length ? [...new Set(dmg)] : [...m.species.types],
    defMult: (t) => defensiveMultiplier(gen, m, t),
    spe: m.species.baseStats.spe,
    bst: bst(m.species),
  };
}

/** Matchup matrix: rows are our Pokémon, columns the foes. */
export function matchupMatrix(gen: Generation, fighters: Fighter[], foes: Foe[]): Matchup[][] {
  return fighters.map((f) => foes.map((foe) => matchup(gen, f, foe)));
}

export interface Answer {
  foe: number;
  /** Index of our best Pokémon against this foe, or -1 if we have none. */
  member: number;
  score: number;
}

export function bestAnswers(matrix: Matchup[][], nFoes: number): Answer[] {
  return Array.from({ length: nFoes }, (_, foe) => {
    let member = -1;
    let score = -Infinity;
    matrix.forEach((row, i) => {
      if (row[foe].score > score) { score = row[foe].score; member = i; }
    });
    return { foe, member, score: member < 0 ? 0 : score };
  });
}

/** Weak answers hurt more than strong ones help, so a hole in the team is never papered over. */
const shape = (x: number) => (x >= 0 ? x : x * 1.5);

/**
 * Objective for the optimizer: for every foe, how well does our best Pokémon handle it (plus a little credit for a
 * backup), with the general team-soundness score as a tie-breaker so the team is still well rounded.
 */
export function counterObjective(gen: Generation, foes: Foe[], weights: Weights = DEFAULT_WEIGHTS, generalShare = 0.35) {
  const types = typesIn(gen);
  const index = new Map(types.map((t, i) => [t, i]));
  const cache = new WeakMap<Feat, Matchup[]>();
  const vs = (f: Feat): Matchup[] => {
    let hit = cache.get(f);
    if (!hit) {
      const fighter: Fighter = {
        attackTypes: [...f.s.types],
        defMult: (t) => f.def[index.get(t) ?? 0],
        spe: f.spe,
        bst: f.bst,
      };
      cache.set(f, (hit = foes.map((foe) => matchup(gen, fighter, foe))));
    }
    return hit;
  };
  const objective = (F: Feat[]) => {
    let answers = 0, off = 0, def = 0;
    foes.forEach((_, e) => {
      const sorted = F.map((f) => vs(f)[e]).sort((a, b) => b.score - a.score);
      if (!sorted.length) return;
      answers += shape(sorted[0].score) + 0.3 * Math.max(0, sorted[1]?.score ?? 0);
      off += sorted[0].off;
      def += sorted[0].def;
    });
    const general = F.length ? scoreFeats(F, types.length, weights).total * generalShare : 0;
    return { total: answers + general, parts: { defense: def, offense: off, stats: general } };
  };
  const rank = (f: Feat) => vs(f).reduce((a, m) => a + Math.max(-1, m.score), 0) + f.bst / 120;
  return { objective, rank };
}

export interface Counter {
  species: Specie;
  matchup: Matchup;
}

/** Best individual answers to a single foe among the Pokémon the rules allow. */
export function topCounters(gen: Generation, rules: RuleInstance[], foe: Foe, megas: boolean, limit = 6): Counter[] {
  const out: Counter[] = [];
  for (const s of speciesPool(gen, megas)) {
    if (s.baseSpecies === foe.species.baseSpecies || speciesViolations(rules, s).length) continue;
    const m: Member = { species: s, moves: [] };
    out.push({ species: s, matchup: matchup(gen, fighterFromMember(gen, m), foe) });
  }
  return out.sort((a, b) => b.matchup.score - a.matchup.score || bst(b.species) - bst(a.species)).slice(0, limit);
}
