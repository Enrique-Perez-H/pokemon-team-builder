import { STATS } from './data';
import type { Generation, Move, Specie, StatKey } from './data';

/** Everything beyond species and moves that decides a Pokémon's real stats and damage. */
export interface Build {
  level: number;
  /** Nature name; ignored before Gen 3. */
  nature: string;
  evs: Record<StatKey, number>;
  ivs: Record<StatKey, number>;
  item?: string;
  ability?: string;
}

export const MAX_EV = 252;
export const MAX_EV_TOTAL = 510;

export const zeroEvs = (): Record<StatKey, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
export const perfectIvs = (): Record<StatKey, number> => ({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });

export const hasNatures = (gen: Generation) => gen.num >= 3;
export const hasItems = (gen: Generation) => gen.num >= 2;

export interface NatureInfo {
  name: string;
  plus?: StatKey;
  minus?: StatKey;
}

export function natureList(gen: Generation): NatureInfo[] {
  if (!hasNatures(gen)) return [];
  return [...gen.natures].map((n) => ({ name: n.name, plus: n.plus as StatKey | undefined, minus: n.minus as StatKey | undefined }));
}

export const natureLabel = (n: NatureInfo) => (n.plus && n.minus ? `${n.name} (+${n.plus.toUpperCase()}, −${n.minus.toUpperCase()})` : `${n.name} (neutral)`);

export function itemList(gen: Generation): string[] {
  if (!hasItems(gen)) return [];
  return [...gen.items].map((i) => i.name).sort((a, b) => a.localeCompare(b));
}

/** Real stats at the build's level. Gens 1–2 always use maximum stat experience and DVs. */
export function computeStats(gen: Generation, species: Specie, build: Build): Record<StatKey, number> {
  const out = {} as Record<StatKey, number>;
  const oldGen = gen.num < 3;
  const nature = hasNatures(gen) ? gen.natures.get(build.nature) : undefined;
  for (const k of STATS) {
    const iv = oldGen ? 30 : build.ivs[k];
    const ev = oldGen ? 252 : build.evs[k];
    out[k] = gen.stats.calc(k, species.baseStats[k], iv, ev, build.level, nature);
  }
  if (species.name === 'Shedinja') out.hp = 1;
  return out;
}

export const evTotal = (evs: Record<StatKey, number>) => STATS.reduce((a, k) => a + evs[k], 0);

/** Clamp to 0–252, round down to a multiple of 4 (the only values that change a stat), cap the total at 510. */
export function normalizeEvs(evs: Record<StatKey, number>, changed?: StatKey): Record<StatKey, number> {
  const out = { ...evs };
  for (const k of STATS) out[k] = Math.max(0, Math.min(MAX_EV, Math.floor((out[k] || 0) / 4) * 4));
  if (changed) {
    const over = evTotal(out) - MAX_EV_TOTAL;
    if (over > 0) out[changed] = Math.max(0, out[changed] - Math.ceil(over / 4) * 4);
  }
  return out;
}

const PHYS_NATURES = { fast: 'Jolly', slow: 'Adamant', bulky: 'Impish' };
const SPEC_NATURES = { fast: 'Timid', slow: 'Modest', bulky: 'Bold' };

/**
 * A sensible competitive default: attackers max their attacking stat and Speed (Jolly/Timid when fast, Adamant/Modest
 * otherwise); bulky Pokémon invest in HP and their weaker defence and carry Leftovers.
 * Attack side comes from the chosen moves when there are any, otherwise from base stats.
 */
export function suggestBuild(gen: Generation, species: Specie, moves: Move[] = [], ability?: string): Build {
  const b = species.baseStats;
  const dmg = moves.filter((m) => m.category !== 'Status');
  let physical = b.atk >= b.spa;
  if (dmg.length) {
    const w = (cat: string) => dmg.filter((m) => m.category === cat).reduce((a, m) => a + (m.basePower || 60), 0);
    physical = w('Physical') >= w('Special');
  }
  const attack = physical ? b.atk : b.spa;
  const bulk = b.hp + b.def + b.spd;
  const bulky = bulk >= 270 && attack < 100;
  const fast = b.spe >= 95;

  const evs = zeroEvs();
  let nature: string;
  if (bulky) {
    const weakerDef: StatKey = b.def <= b.spd ? 'def' : 'spd';
    evs.hp = 252;
    evs[weakerDef] = 252;
    evs[weakerDef === 'def' ? 'spd' : 'def'] = 4;
    nature = weakerDef === 'def' ? (physical ? 'Impish' : 'Bold') : physical ? 'Careful' : 'Calm';
  } else {
    const side: StatKey = physical ? 'atk' : 'spa';
    const table = physical ? PHYS_NATURES : SPEC_NATURES;
    evs[side] = 252;
    if (b.spe >= 60) { evs.spe = 252; evs.hp = 4; nature = fast ? table.fast : table.slow; }
    else { evs.hp = 252; evs.def = 4; nature = table.slow; }
  }

  const exists = (name: string) => !!gen.items.get(name);
  let item: string | undefined;
  if (hasItems(gen)) {
    if (bulky) item = exists('Leftovers') ? 'Leftovers' : undefined;
    else item = exists('Life Orb') ? 'Life Orb' : exists('Leftovers') ? 'Leftovers' : undefined;
  }

  return { level: 100, nature: hasNatures(gen) ? nature : 'Hardy', evs, ivs: perfectIvs(), item, ability };
}
