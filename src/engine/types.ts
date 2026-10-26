import type { Generation, Move, Specie, TypeName } from './data';

/** A resolved team member: everything the analysis needs, no UI state. */
export interface Member {
  species: Specie;
  ability?: string;
  moves: Move[];
  /** Tera type chosen for the Pokémon (Gen 9). It only changes typing when Terastallized. */
  tera?: TypeName;
}

// @pkmn damageTaken codes: 0 = neutral, 1 = weak, 2 = resist, 3 = immune
const CODE = [1, 2, 0.5, 0];

export function typeMultiplier(gen: Generation, atk: TypeName, defTypes: readonly TypeName[]): number {
  let m = 1;
  for (const d of defTypes) {
    const t = gen.types.get(d);
    if (t) m *= CODE[(t as unknown as { damageTaken: Record<string, number> }).damageTaken[atk] ?? 0];
  }
  return m;
}

const ABILITY_IMMUNE: Record<string, TypeName> = {
  Levitate: 'Ground', 'Earth Eater': 'Ground',
  'Flash Fire': 'Fire', 'Well-Baked Body': 'Fire',
  'Water Absorb': 'Water', 'Storm Drain': 'Water', 'Dry Skin': 'Water',
  'Volt Absorb': 'Electric', 'Lightning Rod': 'Electric', 'Motor Drive': 'Electric',
  'Sap Sipper': 'Grass',
};
const ABILITY_HALVE: Record<string, TypeName[]> = {
  'Thick Fat': ['Fire', 'Ice'],
  Heatproof: ['Fire'],
};

/** Damage multiplier of an attacking type against a member, including defensive abilities (and Tera typing when `terastallized`). */
export function defensiveMultiplier(gen: Generation, member: Member, atk: TypeName, terastallized = false): number {
  const types = terastallized && member.tera ? [member.tera] : member.species.types;
  let m = typeMultiplier(gen, atk, types);
  const ab = gen.num >= 3 ? member.ability : undefined;
  if (ab) {
    if (ABILITY_IMMUNE[ab] === atk) return 0;
    if (ABILITY_HALVE[ab]?.includes(atk)) m *= 0.5;
  }
  return m;
}

/** Multiplier of a move against a defender's types (handles Freeze-Dry). */
export function moveMultiplier(gen: Generation, move: Move, defTypes: readonly TypeName[]): number {
  if (move.id === 'freezedry') {
    let m = 1;
    for (const d of defTypes) m *= d === 'Water' ? 2 : typeMultiplier(gen, 'Ice', [d]);
    return m;
  }
  return typeMultiplier(gen, move.type, defTypes);
}
