import { abilitiesOf, bst, speciesPool, typesIn } from './data';
import type { Generation, Specie } from './data';
import { defensiveMultiplier, typeMultiplier } from './types';
import { speciesViolations, wouldViolate } from './rules';
import type { RuleInstance } from './rules';
import { isLegendary } from './data';

export interface Weights {
  defense: number;
  offense: number;
  stats: number;
}

export const DEFAULT_WEIGHTS: Weights = { defense: 1, offense: 1, stats: 1 };

export interface OptimizeOptions {
  gen: Generation;
  rules: RuleInstance[];
  /** Fixed Pokémon by slot; null slots are filled by the optimizer. */
  locked: (Specie | null)[];
  megas: boolean;
  weights?: Weights;
  /** Beam width (states kept per step). */
  beam?: number;
  /** How many top single Pokémon are considered at each step. */
  candidates?: number;
  /** How many distinct teams to return. */
  results?: number;
}

export interface OptimizedTeam {
  /** Same length as `locked`: locked Pokémon stay in place. */
  slots: Specie[];
  /** Suggested ability per slot (only set when an ability improves the defensive profile). */
  abilities: (string | undefined)[];
  score: number;
  parts: Weights;
}

/** Precomputed per-Pokémon vectors so scoring a team is a few hundred additions. */
interface Feat {
  s: Specie;
  ability?: string;
  def: Float64Array;
  off: Uint8Array;
  bst: number;
  spe: number;
  side: -1 | 0 | 1;
}

function makeFeat(gen: Generation, s: Specie, types: ReturnType<typeof typesIn>): Feat {
  const vec = (ability?: string) => Float64Array.from(types, (t) => defensiveMultiplier(gen, { species: s, ability, moves: [] }, t));
  let def = vec();
  let ability: string | undefined;
  let gain = 0;
  for (const a of abilitiesOf(gen, s)) {
    const v = vec(a);
    const g = def.reduce((acc, x, i) => acc + (x - v[i]), 0);
    if (g > gain + 1e-9) { gain = g; ability = a; }
  }
  if (ability) def = vec(ability);
  const off = Uint8Array.from(types, (t) => (s.types.some((st) => typeMultiplier(gen, st, [t]) > 1) ? 1 : 0));
  const b = s.baseStats;
  const side = b.atk > b.spa + 15 ? 1 : b.spa > b.atk + 15 ? -1 : 0;
  return { s, ability, def, off, bst: bst(s), spe: b.spe, side };
}

export function scoreFeats(F: Feat[], nTypes: number, w: Weights): { total: number; parts: Weights } {
  let defense = 0;
  let offense = 0;
  for (let t = 0; t < nTypes; t++) {
    let weak = 0, cover = 0, imm = 0, quad = 0, srcs = 0;
    for (const f of F) {
      const m = f.def[t];
      if (m > 1) { weak++; if (m >= 4) quad++; }
      else if (m === 0) { imm++; cover++; }
      else if (m < 1) cover++;
      srcs += f.off[t];
    }
    const deficit = Math.max(0, weak - cover);
    defense += -deficit * deficit - quad * 0.8 - (weak >= 4 ? 2 : 0) + Math.min(cover, 2) * 0.35 + imm * 0.15;
    offense += srcs === 0 ? -1.5 : 1 + Math.min(srcs - 1, 2) * 0.25;
  }
  let stats = 0;
  if (F.length) {
    stats += (F.reduce((a, f) => a + f.bst, 0) / F.length - 450) / 50;
    stats += Math.min(2, F.filter((f) => f.spe >= 95).length) * 0.4;
    const phys = F.filter((f) => f.side === 1).length;
    const spec = F.filter((f) => f.side === -1).length;
    stats -= 0.25 * Math.max(0, Math.abs(phys - spec) - 1);
  }
  const parts = { defense: defense * w.defense, offense: offense * w.offense, stats: stats * w.stats };
  return { total: parts.defense + parts.offense + parts.stats, parts };
}

/** Score an arbitrary team with the optimizer's objective (useful for comparing teams). */
export function scoreSpecies(gen: Generation, team: Specie[], w: Weights = DEFAULT_WEIGHTS) {
  const types = typesIn(gen);
  return scoreFeats(team.map((s) => makeFeat(gen, s, types)), types.length, w);
}

interface State {
  idx: number[]; // indexes into the candidate list
  score: number;
}

/**
 * Search the rule-legal pool for the best team. Beam search builds teams one Pokémon at a time,
 * then a swap-based local search polishes the finalists. All rules are monotone (adding a member
 * never fixes a violation), so checking partial teams is sound.
 */
export function optimizeTeam(opts: OptimizeOptions): OptimizedTeam[] {
  const { gen, rules, locked, megas } = opts;
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const beamWidth = opts.beam ?? 40;
  const nCand = opts.candidates ?? 220;
  const nResults = opts.results ?? 3;
  const types = typesIn(gen);
  const T = types.length;

  const featCache = new Map<string, Feat>();
  const feat = (s: Specie) => {
    let f = featCache.get(s.name);
    if (!f) featCache.set(s.name, (f = makeFeat(gen, s, types)));
    return f;
  };

  const lockedSpecies = locked.filter((s): s is Specie => !!s);
  const lockedNames = new Set(lockedSpecies.map((s) => s.name));
  const need = locked.length - lockedSpecies.length;

  // Pre-rank the individually legal pool.
  const pool = speciesPool(gen, megas).filter((s) => !lockedNames.has(s.name) && speciesViolations(rules, s).length === 0);
  const single = (f: Feat) => {
    let v = f.bst / 40;
    for (let t = 0; t < T; t++) v += f.def[t] < 1 ? 0.3 : f.def[t] > 1 ? -0.3 * f.def[t] : 0;
    return v + f.off.reduce((a, x) => a + x, 0) * 0.25;
  };
  const cands = pool
    .map((s) => ({ s, f: feat(s) }))
    .sort((a, b) => single(b.f) - single(a.f))
    .slice(0, nCand);

  const base = lockedSpecies.map((s) => s);
  const lockedFeats = base.map(feat);
  const total = (idx: number[]) => scoreFeats([...lockedFeats, ...idx.map((i) => cands[i].f)], T, w);
  const members = (idx: number[]) => [...base, ...idx.map((i) => cands[i].s)];

  let beam: State[] = [{ idx: [], score: total([]).total }];
  for (let step = 0; step < need; step++) {
    const next = new Map<string, State>();
    for (const st of beam) {
      const team = members(st.idx);
      for (let c = 0; c < cands.length; c++) {
        if (st.idx.includes(c)) continue;
        const idx = [...st.idx, c].sort((a, b) => a - b);
        const key = idx.join(',');
        if (next.has(key)) continue;
        if (wouldViolate(rules, team, cands[c].s, team.length).length) continue;
        next.set(key, { idx, score: total(idx).total });
      }
    }
    beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, beamWidth);
    if (!beam.length) return [];
  }

  // Local search: swap any chosen member for any candidate while it improves the score.
  const polish = (st: State): State => {
    let cur = st;
    for (let iter = 0; iter < 12; iter++) {
      let best = cur;
      for (let p = 0; p < cur.idx.length; p++) {
        for (let c = 0; c < cands.length; c++) {
          if (cur.idx.includes(c)) continue;
          const idx = cur.idx.map((x, k) => (k === p ? c : x)).sort((a, b) => a - b);
          const sc = total(idx).total;
          if (sc <= best.score + 1e-9) continue;
          const team = [...base, ...cur.idx.filter((_, k) => k !== p).map((i) => cands[i].s)];
          if (wouldViolate(rules, team, cands[c].s, team.length).length) continue;
          best = { idx, score: sc };
        }
      }
      if (best === cur) break;
      cur = best;
    }
    return cur;
  };

  const seen = new Set<string>();
  const finals: State[] = [];
  for (const st of beam.slice(0, Math.max(nResults * 3, 6)).map(polish).sort((a, b) => b.score - a.score)) {
    const key = st.idx.join(',');
    if (!seen.has(key)) { seen.add(key); finals.push(st); }
  }

  return finals.slice(0, nResults).map((st) => {
    const chosen = st.idx.map((i) => cands[i]).sort((a, b) => b.f.bst - a.f.bst);
    let k = 0;
    const slots: Specie[] = [];
    const abilities: (string | undefined)[] = [];
    for (const l of locked) {
      if (l) { slots.push(l); abilities.push(undefined); }
      else { slots.push(chosen[k].s); abilities.push(chosen[k].f.ability); k++; }
    }
    const { total: score, parts } = total(st.idx);
    return { slots, abilities, score, parts };
  });
}

/** Number of legendaries, exposed for result display. */
export const legendaryCount = (team: Specie[]) => team.filter(isLegendary).length;
