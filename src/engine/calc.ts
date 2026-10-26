import { Field, Generations as CalcGenerations, Move, Pokemon, calculate } from '@smogon/calc';
import { ALL_GENS, STATS } from './data';
import type { StatKey } from './data';
import type { Build } from './sets';

export type Status = '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
export type Weather = '' | 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Hail';
export type Terrain = '' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty';

/** One side of a calculation: a Pokémon, its build and its temporary battle state. */
export interface Combatant {
  species: string;
  build: Build;
  boosts: Record<StatKey, number>;
  status: Status;
}

export interface FieldOptions {
  weather: Weather;
  terrain: Terrain;
  crit: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
}

export const NO_BOOSTS = (): Record<StatKey, number> => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
export const NO_FIELD: FieldOptions = { weather: '', terrain: '', crit: false, reflect: false, lightScreen: false, auroraVeil: false };

export interface DamageResult {
  ok: boolean;
  error?: string;
  /** Status moves deal no damage. */
  status?: boolean;
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  defenderHp: number;
  /** All 16 damage rolls (single-hit moves only). */
  rolls: number[];
  desc: string;
  ko: string;
  moveType?: string;
  category?: string;
  power?: number;
}

const fail = (error: string): DamageResult => ({ ok: false, error, min: 0, max: 0, minPct: 0, maxPct: 0, defenderHp: 0, rolls: [], desc: '', ko: '' });

/** The calc library covers every species and move ever released in its Gen 9 data, so "every gen" uses 9. */
export const calcGen = (genNum: number) => (genNum === ALL_GENS ? 9 : genNum);

function toPokemon(g: number, c: Combatant): Pokemon {
  const b = c.build;
  const opts: Record<string, unknown> = { level: b.level, status: c.status || undefined };
  if (g >= 3) {
    opts.nature = b.nature;
    opts.evs = b.evs;
    opts.ivs = b.ivs;
    opts.ability = b.ability || undefined;
  }
  if (g >= 2) opts.item = b.item || undefined;
  const boosts: Record<string, number> = {};
  for (const k of STATS) if (k !== 'hp' && c.boosts[k]) boosts[k] = c.boosts[k];
  opts.boosts = boosts;
  return new Pokemon(g as never, c.species, opts as never);
}

export function calcDamage(genNum: number, attacker: Combatant, defender: Combatant, moveName: string, field: FieldOptions = NO_FIELD): DamageResult {
  const g = calcGen(genNum);
  try {
    // The library quietly accepts unknown names, so check them against its own data first.
    const data = CalcGenerations.get(g as never);
    const id = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!data.species.get(id(attacker.species) as never)) return fail(`Unknown Pokémon: ${attacker.species}`);
    if (!data.species.get(id(defender.species) as never)) return fail(`Unknown Pokémon: ${defender.species}`);
    if (!data.moves.get(id(moveName) as never)) return fail(`Unknown move: ${moveName}`);
    const A = toPokemon(g, attacker);
    const D = toPokemon(g, defender);
    const move = new Move(g as never, moveName, { isCrit: field.crit } as never);
    const f = new Field({
      gameType: 'Singles',
      weather: field.weather || undefined,
      terrain: field.terrain || undefined,
      defenderSide: { isReflect: field.reflect, isLightScreen: field.lightScreen, isAuroraVeil: field.auroraVeil },
    } as never);
    const result = calculate(g as never, A, D, move, f);
    const hp = D.maxHP();
    const base = { defenderHp: hp, moveType: move.type, category: move.category, power: move.bp };
    if (move.category === 'Status') return { ...fail(''), ok: true, status: true, ...base, desc: `${moveName} is a status move.` };
    const [min, max] = result.range();
    const rolls = Array.isArray(result.damage) && result.damage.every((x) => typeof x === 'number') ? (result.damage as number[]) : [];
    if (max <= 0) {
      return { ...fail(''), ok: true, ...base, desc: `${moveName} does no damage to ${defender.species}.`, ko: 'No effect' };
    }
    return {
      ok: true,
      min, max,
      minPct: (min / hp) * 100,
      maxPct: (max / hp) * 100,
      rolls,
      desc: result.desc(),
      ko: result.kochance().text,
      ...base,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not calculate');
  }
}

/** The strongest of several moves by maximum damage. */
export function bestMove(genNum: number, attacker: Combatant, defender: Combatant, moves: string[], field: FieldOptions = NO_FIELD) {
  let best: { move: string; result: DamageResult } | undefined;
  for (const m of moves) {
    const result = calcDamage(genNum, attacker, defender, m, field);
    if (!result.ok || result.status) continue;
    if (!best || result.max > best.result.max) best = { move: m, result };
  }
  return best;
}

/** A combatant with no boosts or status, the usual starting point. */
export const combatant = (species: string, build: Build): Combatant => ({ species, build, boosts: NO_BOOSTS(), status: '' });
