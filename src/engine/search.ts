import { bst, speciesPool } from './data';
import type { Generation, Specie } from './data';
import { counterObjective } from './counter';
import type { Foe } from './counter';
import { optimizeTeam, shortlistCandidates, DEFAULT_WEIGHTS } from './optimize';
import type { OptimizedTeam, Weights } from './optimize';
import { buildMatchupTable, prepareFoes } from './realdamage';
import type { FoeSet, RealMatchup } from './realdamage';
import { speciesViolations, TIER_ORDER } from './rules';
import type { RuleInstance } from './rules';
import { moveTypesOf } from './moves';

export interface VsFoesOptions {
  gen: Generation;
  rules: RuleInstance[];
  locked: (Specie | null)[];
  megas: boolean;
  foes: Specie[];
  weights?: Weights;
  /** Judge matchups by real damage (slower, more accurate) instead of types and speed only. */
  real: boolean;
  /** How many Pokémon get the expensive real-damage treatment. */
  shortlist?: number;
  /** How much the general team-soundness score counts next to the matchups. */
  generalShare?: number;
  onProgress?: (done: number) => void;
}

export interface VsFoesResult {
  teams: OptimizedTeam[];
  foeSets: FoeSet[];
  /** Real matchups for every Pokémon that was evaluated (empty when `real` is off). */
  table: Map<string, RealMatchup[]>;
}

/**
 * Best team against a set of foes. With `real`, candidates are shortlisted by a cheap type-based score, every
 * shortlisted Pokémon is run through the damage calculator against every foe once, and the team search then looks
 * those numbers up — so thousands of teams are compared without thousands of calculations.
 */
export async function optimizeVsFoes(opts: VsFoesOptions): Promise<VsFoesResult> {
  const { gen, rules, locked, megas } = opts;
  const foeSets = await prepareFoes(gen, opts.foes);
  const foes: Foe[] = foeSets.map((f) => ({ species: f.species, attackTypes: moveTypesOf(gen, f.moves, f.species) }));
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const share = opts.generalShare ?? 0.35;

  if (!opts.real) {
    const { objective, rank } = counterObjective(gen, foes, weights, share);
    return { teams: optimizeTeam({ gen, rules, locked, megas, objective, rank }), foeSets, table: new Map() };
  }

  const typeBased = counterObjective(gen, foes, weights, share);
  const shortlist = shortlistCandidates({ gen, rules, locked, megas, rank: typeBased.rank }, opts.shortlist ?? 110);
  const lockedSpecies = locked.filter((s): s is Specie => !!s);
  const table = await buildMatchupTable(gen, [...shortlist, ...lockedSpecies], foeSets, { onProgress: opts.onProgress });
  const { objective, rank } = counterObjective(gen, foes, weights, share, table);
  return { teams: optimizeTeam({ gen, rules, locked, megas, objective, rank, pool: shortlist }), foeSets, table };
}

const tierIndex = (t: string) => {
  const i = TIER_ORDER.indexOf(t);
  return i < 0 ? TIER_ORDER.length : i;
};

/**
 * The strongest Pokémon the rules allow, as a stand-in for "what the team will face". Ranked by competitive tier and
 * base stat total, skipping a Pokémon once two already share its main type so the benchmark stays varied.
 */
export function pickThreats(gen: Generation, rules: RuleInstance[], megas: boolean, n = 10): Specie[] {
  const ranked = speciesPool(gen, megas)
    .filter((s) => speciesViolations(rules, s).length === 0)
    .sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier) || bst(b) - bst(a));
  const perType = new Map<string, number>();
  const out: Specie[] = [];
  for (const s of ranked) {
    const main = s.types[0];
    if ((perType.get(main) ?? 0) >= 2 || out.some((o) => (o.baseSpecies || o.name) === (s.baseSpecies || s.name))) continue;
    perType.set(main, (perType.get(main) ?? 0) + 1);
    out.push(s);
    if (out.length >= n) break;
  }
  return out;
}
