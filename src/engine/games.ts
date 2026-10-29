import type { Specie } from '@pkmn/data';

/** A main-series game (expansions are merged into their base game). */
export interface GameInfo {
  id: string;
  label: string;
  /** Generation whose mechanics the game uses. */
  gen: number;
  /** Whether Mega Evolution exists in the game. */
  megas: boolean;
}

export const GAME_LIST: GameInfo[] = [
  { id: 'red-blue', label: 'Red / Blue', gen: 1, megas: false },
  { id: 'yellow', label: 'Yellow', gen: 1, megas: false },
  { id: 'gold-silver', label: 'Gold / Silver', gen: 2, megas: false },
  { id: 'crystal', label: 'Crystal', gen: 2, megas: false },
  { id: 'ruby-sapphire', label: 'Ruby / Sapphire', gen: 3, megas: false },
  { id: 'emerald', label: 'Emerald', gen: 3, megas: false },
  { id: 'firered-leafgreen', label: 'FireRed / LeafGreen', gen: 3, megas: false },
  { id: 'diamond-pearl', label: 'Diamond / Pearl', gen: 4, megas: false },
  { id: 'platinum', label: 'Platinum', gen: 4, megas: false },
  { id: 'heartgold-soulsilver', label: 'HeartGold / SoulSilver', gen: 4, megas: false },
  { id: 'black-white', label: 'Black / White', gen: 5, megas: false },
  { id: 'black-2-white-2', label: 'Black 2 / White 2', gen: 5, megas: false },
  { id: 'x-y', label: 'X / Y', gen: 6, megas: true },
  { id: 'omega-ruby-alpha-sapphire', label: 'Omega Ruby / Alpha Sapphire', gen: 6, megas: true },
  { id: 'sun-moon', label: 'Sun / Moon', gen: 7, megas: true },
  { id: 'ultra-sun-ultra-moon', label: 'Ultra Sun / Ultra Moon', gen: 7, megas: true },
  { id: 'lets-go', label: "Let's Go Pikachu / Eevee", gen: 7, megas: true },
  { id: 'sword-shield', label: 'Sword / Shield (+ DLC)', gen: 8, megas: false },
  { id: 'brilliant-diamond-shining-pearl', label: 'Brilliant Diamond / Shining Pearl', gen: 8, megas: false },
  { id: 'legends-arceus', label: 'Legends: Arceus', gen: 8, megas: false },
  { id: 'scarlet-violet', label: 'Scarlet / Violet (+ DLC)', gen: 9, megas: false },
  { id: 'radical-red', label: 'Radical Red (FireRed hack, unofficial)', gen: 8, megas: true },
  { id: 'legends-za', label: 'Legends: Z-A (+ DLC)', gen: 9, megas: true },
];

export const GAME_BY_ID: Record<string, GameInfo> = Object.fromEntries(GAME_LIST.map((g) => [g.id, g]));

/** What the per-game JSON files contain. */
export interface RawGameData {
  dex: number[];
  moves: string[];
  learn: Record<string, number[]> | null;
}

export interface GameData {
  /** National dex numbers obtainable in the game. */
  dex: Set<number>;
  /** Every move that exists in the game, or null when PokeAPI has no move data for it yet. */
  moves: Set<string> | null;
  /** Moves each Pokémon (by Showdown id) can learn in the game. */
  learn: Map<string, Set<string>> | null;
}

export function parseGameData(raw: RawGameData): GameData {
  const hasMoves = !!raw.learn && raw.moves.length > 0;
  return {
    dex: new Set(raw.dex),
    moves: hasMoves ? new Set(raw.moves) : null,
    learn: hasMoves ? new Map(Object.entries(raw.learn!).map(([p, idx]) => [p, new Set(idx.map((i) => raw.moves[i]))])) : null,
  };
}

const loaded = new Map<string, GameData>();
const inflight = new Map<string, Promise<GameData>>();

/** Data for a game if it has been loaded (it is fetched lazily when the game is first selected). */
export const gameData = (id?: string): GameData | undefined => (id ? loaded.get(id) : undefined);

export function registerGameData(id: string, raw: RawGameData): GameData {
  const data = parseGameData(raw);
  loaded.set(id, data);
  return data;
}

export function loadGameData(id: string, baseUrl = '/'): Promise<GameData> {
  const hit = loaded.get(id);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(id);
  if (!p) {
    p = fetch(`${baseUrl}data/games/${id}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load ${id}`);
        return r.json() as Promise<RawGameData>;
      })
      .then((raw) => registerGameData(id, raw))
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  return p;
}

/** Regional forms only exist in the games that feature their region. */
const REGIONAL_FORMS: [RegExp, string[]][] = [
  [/^Alola/, ['sun-moon', 'ultra-sun-ultra-moon', 'lets-go', 'radical-red']],
  [/^Galar/, ['sword-shield', 'radical-red']],
  [/^Hisui/, ['legends-arceus', 'scarlet-violet', 'legends-za']],
  [/^Paldea/, ['scarlet-violet']],
];

/**
 * Whether a species can be obtained in a game: it must be in the game's regional Pokédex, already exist in that
 * generation, and regional forms and Megas only count where the game has them.
 */
export function availableInGame(game: GameInfo, data: GameData, s: Specie): boolean {
  if (!data.dex.has(s.num) || s.gen > game.gen) return false;
  if ((s.isMega || s.isPrimal) && !game.megas && !(s.isPrimal && game.id === 'omega-ruby-alpha-sapphire')) return false;
  if (s.forme) {
    for (const [pattern, games] of REGIONAL_FORMS) if (pattern.test(s.forme)) return games.includes(game.id);
  }
  return true;
}
