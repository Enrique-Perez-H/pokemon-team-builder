// Builds public/data/games/<game>.json from PokeAPI's CSV data.
//
//   mkdir csv && cd csv
//   for f in version_groups pokedex_version_groups pokemon pokemon_moves moves pokemon_dex_numbers; do
//     curl -sO https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/$f.csv; done
//   node scripts/build-game-data.mjs ./csv public/data/games
//
// Each file holds the game's regional Pokédex (national dex numbers) and, where PokeAPI has them, the exact moves
// every Pokémon can learn in that game:  { dex: number[], moves: string[], learn: { [pokemonId]: number[] } | null }
// `learn` values index into `moves`. Pokémon and move ids are the lowercase letters/digits of PokeAPI's identifiers,
// which match Pokémon Showdown ids ("landorus-therian" -> "landorustherian").
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [csvDir, outDir] = process.argv.slice(2);
if (!csvDir || !outDir) throw new Error('usage: node build-game-data.mjs <csv dir> <out dir>');

/** Games, as sets of PokeAPI version groups (expansions are merged into their base game). */
const GAMES = {
  'red-blue': [1], yellow: [2], 'gold-silver': [3], crystal: [4], 'ruby-sapphire': [5], emerald: [6],
  'firered-leafgreen': [7], 'diamond-pearl': [8], platinum: [9], 'heartgold-soulsilver': [10],
  'black-white': [11], 'black-2-white-2': [14], 'x-y': [15], 'omega-ruby-alpha-sapphire': [16],
  'sun-moon': [17], 'ultra-sun-ultra-moon': [18], 'lets-go': [19], 'sword-shield': [20, 21, 22],
  'brilliant-diamond-shining-pearl': [23], 'legends-arceus': [24], 'scarlet-violet': [25, 26, 27], 'legends-za': [30, 31],
};

const rows = (name) => {
  const [head, ...lines] = readFileSync(join(csvDir, `${name}.csv`), 'utf8').trim().split('\n');
  const cols = head.split(',');
  return lines.map((l) => { const f = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, f[i]])); });
};
const id = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const dexVersionGroups = rows('pokedex_version_groups');
const dexNumbers = rows('pokemon_dex_numbers');
const pokemon = new Map(rows('pokemon').map((p) => [p.id, id(p.identifier)]));
const moveName = new Map(rows('moves').map((m) => [m.id, id(m.identifier)]));
const pokemonMoves = rows('pokemon_moves');

mkdirSync(outDir, { recursive: true });
for (const [game, vgs] of Object.entries(GAMES)) {
  const vgSet = new Set(vgs.map(String));
  const dexIds = new Set(dexVersionGroups.filter((r) => vgSet.has(r.version_group_id)).map((r) => r.pokedex_id));
  const dex = [...new Set(dexNumbers.filter((r) => dexIds.has(r.pokedex_id)).map((r) => Number(r.species_id)))].sort((a, b) => a - b);

  const learned = new Map(); // pokemon id -> Set of move ids
  for (const r of pokemonMoves) {
    if (!vgSet.has(r.version_group_id)) continue;
    const p = pokemon.get(r.pokemon_id);
    const m = moveName.get(r.move_id);
    if (!p || !m) continue;
    if (!learned.has(p)) learned.set(p, new Set());
    learned.get(p).add(m);
  }

  let moves = null;
  let learn = null;
  if (learned.size) {
    moves = [...new Set([...learned.values()].flatMap((s) => [...s]))].sort();
    const index = new Map(moves.map((m, i) => [m, i]));
    learn = Object.fromEntries([...learned].sort(([a], [b]) => a.localeCompare(b)).map(([p, set]) => [p, [...set].map((m) => index.get(m)).sort((a, b) => a - b)]));
  }
  writeFileSync(join(outDir, `${game}.json`), JSON.stringify({ dex, moves: moves ?? [], learn }));
  console.log(game.padEnd(34), `dex ${String(dex.length).padStart(4)}`, learn ? `moves ${moves.length}, pokémon ${Object.keys(learn).length}` : 'no move data');
}
