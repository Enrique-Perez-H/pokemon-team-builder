import { Dex } from '@pkmn/dex';
import { Generations } from '@pkmn/data';
import type { Generation, Move, Specie, TypeName } from '@pkmn/data';

export type { Generation, Move, Specie, TypeName };

export const gens = new Generations(Dex);

/** Pseudo generation number for the "every generation" option. */
export const ALL_GENS = 0;

export const ALL_TYPES: TypeName[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];

export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
export type StatKey = (typeof STATS)[number];
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

/** Games grouped by the generation whose mechanics they use. Regional dex limits come later. */
export const GAMES: { gen: number; label: string }[] = [
  { gen: ALL_GENS, label: 'Every generation (all Pokémon and moves, modern type chart)' },
  { gen: 1, label: 'Red / Blue / Yellow' },
  { gen: 2, label: 'Gold / Silver / Crystal' },
  { gen: 3, label: 'Ruby / Sapphire / Emerald / FRLG' },
  { gen: 4, label: 'Diamond / Pearl / Platinum / HGSS' },
  { gen: 5, label: 'Black / White (1 & 2)' },
  { gen: 6, label: 'X / Y / ORAS' },
  { gen: 7, label: 'Sun / Moon / USUM' },
  { gen: 8, label: 'Sword / Shield / BDSP / Legends Arceus' },
  { gen: 9, label: 'Scarlet / Violet' },
];

/**
 * Gen 9 mechanics (modern type chart, Fairy) but with every Pokémon and move that later generations
 * dropped still available, so any Pokémon from any game can be picked.
 */
const allGen = new Generations(Dex, (d) => {
  const ns = (d as { isNonstandard?: string | null }).isNonstandard;
  return !!d.exists && (ns == null || ns === 'Past');
}).get(9);

export const getGen = (n: number): Generation => (n === ALL_GENS ? allGen : gens.get(n));

/** Stable id for caches: the all-generations view must not share keys with real Gen 9. */
export const genId = (gen: Generation): number => (gen === allGen ? ALL_GENS : gen.num);

/** Types that exist in a generation (no Dark/Steel before 2, no Fairy before 6). */
export function typesIn(gen: Generation): TypeName[] {
  return ALL_TYPES.filter((t) => {
    const ty = gen.types.get(t);
    return !!ty && ty.exists !== false;
  });
}

const poolCache = new Map<string, Specie[]>();

/** Every selectable species in a generation. Battle-only forms and cosmetic variants are skipped. */
export function speciesPool(gen: Generation, allowMegas: boolean): Specie[] {
  const key = `${genId(gen)}:${allowMegas}`;
  const hit = poolCache.get(key);
  if (hit) return hit;
  const out: Specie[] = [];
  for (const s of gen.species) {
    if (!s.exists || s.num <= 0) continue;
    if (s.isCosmeticForme || s.battleOnly || s.name.endsWith('-Gmax') || s.name.endsWith('-Eternamax')) continue;
    if (s.baseSpecies === 'Pikachu' && s.forme) continue;
    if ((s.baseSpecies === 'Arceus' || s.baseSpecies === 'Silvally') && s.forme) continue; // item-dependent type forms
    if ((s.isMega || s.isPrimal) && !allowMegas) continue;
    out.push(s);
  }
  poolCache.set(key, out);
  return out;
}

export function isLegendary(s: Specie): boolean {
  return s.tags.some((t) => t === 'Mythical' || t === 'Restricted Legendary' || t === 'Sub-Legendary');
}

export function abilitiesOf(gen: Generation, s: Specie): string[] {
  if (gen.num < 3) return [];
  return [...new Set(Object.values(s.abilities))];
}

const learnCache = new Map<string, Promise<Move[]>>();

/** Moves a species can learn in a generation, sorted by name. Cached; resolves lazily. */
export function learnableMoves(gen: Generation, speciesName: string): Promise<Move[]> {
  const key = `${genId(gen)}:${speciesName}`;
  let p = learnCache.get(key);
  if (!p) {
    p = (async () => {
      const species = gen.species.get(speciesName);
      if (!species) return [];
      const learn = await gen.learnsets.learnable(species.id);
      if (!learn) return [];
      const moves: Move[] = [];
      for (const id of Object.keys(learn)) {
        const m = gen.moves.get(id);
        if (m && m.exists !== false) moves.push(m);
      }
      return moves.sort((a, b) => a.name.localeCompare(b.name));
    })();
    learnCache.set(key, p);
  }
  return p;
}

export const isDamaging = (m: Move) => m.category !== 'Status';

export const bst = (s: Specie): number => STATS.reduce((a, k) => a + s.baseStats[k], 0);
