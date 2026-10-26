import { genId, typesIn } from './data';
import type { Generation, Move, Specie } from './data';
import { NO_FIELD, bestMove, combatant, loadCalc } from './calc';
import type { Combatant, FieldOptions } from './calc';
import { autoMoves } from './moves';
import { makeFeat } from './optimize';
import { computeStats, suggestBuild } from './sets';
import type { Matchup } from './counter';
import { topCounters } from './counter';
import type { Foe } from './counter';
import type { RuleInstance } from './rules';

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const moveObjects = (gen: Generation, names: string[]): Move[] => names.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; });

/** An opposing Pokémon with a concrete set: its likely attacking moves, a standard build and its real Speed. */
export interface FoeSet {
  species: Specie;
  moves: string[];
  combatant: Combatant;
  speed: number;
}

export async function prepareFoes(gen: Generation, foes: Specie[]): Promise<FoeSet[]> {
  await loadCalc();
  return Promise.all(foes.map(async (species) => {
    const moves = await autoMoves(gen, species);
    const build = suggestBuild(gen, species, moveObjects(gen, moves));
    return { species, moves, combatant: combatant(species.name, build), speed: computeStats(gen, species, build).spe };
  }));
}

/** A matchup judged by real damage: how much each side takes off the other with its best move. */
export interface RealMatchup extends Matchup {
  /** Average % of the foe's HP our best move deals (and which move). */
  ourPct: number;
  ourMove?: string;
  /** Average % of our HP the foe's best move deals (and which move). */
  theirPct: number;
  theirMove?: string;
}

const avgPct = (r?: { result: { minPct: number; maxPct: number } }) => (r ? (r.result.minPct + r.result.maxPct) / 2 : 0);

/** 34% per hit is a 3HKO: that is the "even" point both damage terms are measured against. */
const EVEN = 34;

export function realMatchup(
  genNum: number,
  us: { combatant: Combatant; moves: string[]; speed: number },
  foe: FoeSet,
  field: FieldOptions = NO_FIELD,
): RealMatchup {
  const ours = bestMove(genNum, us.combatant, foe.combatant, us.moves, field);
  const theirs = bestMove(genNum, foe.combatant, us.combatant, foe.moves, field);
  const ourPct = avgPct(ours);
  const theirPct = avgPct(theirs);
  const off = clamp(Math.log2((ourPct + 1) / EVEN), -2, 2);
  const def = clamp(-Math.log2((theirPct + 1) / EVEN), -2, 2);
  const speed = us.speed > foe.speed ? 0.5 : us.speed < foe.speed ? -0.5 : 0;
  // Getting knocked out before moving, or knocking out first, matters more than the average suggests.
  let bonus = 0;
  if (ours && ours.result.minPct >= 100 && us.speed >= foe.speed) bonus += 0.5;
  if (theirs && theirs.result.minPct >= 100 && foe.speed >= us.speed) bonus -= 0.5;
  return {
    score: off + def + speed + bonus, off, def, speed,
    ourPct, ourMove: ours?.move, theirPct, theirMove: theirs?.move,
  };
}

export interface TableOptions {
  /** Called with 0–1 as candidates are processed. */
  onProgress?: (done: number) => void;
  /** Battle conditions for the calculations (doubles applies spread-move reduction). */
  field?: FieldOptions;
}

/**
 * Real matchups for every candidate against every foe. Each candidate gets its best defensive ability,
 * a standard build and attacking moves aimed at the foes' types, so the numbers reflect what the
 * optimizer will actually assign it.
 */
export async function buildMatchupTable(
  gen: Generation,
  candidates: Specie[],
  foes: FoeSet[],
  opts: TableOptions = {},
): Promise<Map<string, RealMatchup[]>> {
  await loadCalc();
  const n = genId(gen);
  const types = typesIn(gen);
  const foeTypes = foes.map((f) => [...f.species.types]);
  const table = new Map<string, RealMatchup[]>();
  for (let i = 0; i < candidates.length; i++) {
    const sp = candidates[i];
    const ability = makeFeat(gen, sp, types).ability;
    const moves = await autoMoves(gen, sp, foeTypes);
    const build = suggestBuild(gen, sp, moveObjects(gen, moves), ability);
    const us = { combatant: combatant(sp.name, build), moves, speed: computeStats(gen, sp, build).spe };
    table.set(sp.name, foes.map((foe) => realMatchup(n, us, foe, opts.field)));
    // Hand control back regularly so the page stays responsive during the long loop.
    if (i % 8 === 7) {
      opts.onProgress?.((i + 1) / candidates.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  opts.onProgress?.(1);
  return table;
}

export interface RealCounter {
  species: Specie;
  matchup: RealMatchup;
}

/** Best single answers to one foe: a quick type-based shortlist re-ranked by real damage. */
export async function topCountersReal(
  gen: Generation,
  rules: RuleInstance[],
  foe: FoeSet,
  megas: boolean,
  limit = 6,
  shortlist = 40,
  field?: FieldOptions,
): Promise<RealCounter[]> {
  const asFoe: Foe = { species: foe.species, attackTypes: [...new Set(moveObjects(gen, foe.moves).map((m) => m.type))] };
  const candidates = topCounters(gen, rules, asFoe, megas, shortlist).map((c) => c.species);
  const table = await buildMatchupTable(gen, candidates, [foe], { field });
  return candidates
    .map((species) => ({ species, matchup: table.get(species.name)![0] }))
    .sort((a, b) => b.matchup.score - a.matchup.score)
    .slice(0, limit);
}
