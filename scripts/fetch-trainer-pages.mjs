// Downloads the Bulbapedia pages that hold Gym Leader, Elite Four and Champion teams, as wikitext, into a cache folder.
//
//   node scripts/fetch-trainer-pages.mjs <cache folder>
//   node scripts/build-trainer-data.mjs <cache folder> public/data/trainers
//
// Uses Bulbapedia's public API, one request per second with a descriptive User-Agent. Already cached pages are skipped,
// so it can be re-run to pick up pages that failed. Bulbapedia text is CC BY-NC-SA 2.5; see the README for attribution.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node fetch-trainer-pages.mjs <cache folder>');
mkdirSync(dir, { recursive: true });

const GYMS = [
  // Kanto
  'Pewter Gym', 'Cerulean Gym', 'Vermilion Gym', 'Celadon Gym', 'Fuchsia Gym', 'Saffron Gym', 'Cinnabar Gym', 'Viridian Gym',
  // Johto
  'Violet Gym', 'Azalea Gym', 'Goldenrod Gym', 'Ecruteak Gym', 'Cianwood Gym', 'Olivine Gym', 'Mahogany Gym', 'Blackthorn Gym',
  // Hoenn
  'Rustboro Gym', 'Dewford Gym', 'Mauville Gym', 'Lavaridge Gym', 'Petalburg Gym', 'Fortree Gym', 'Mossdeep Gym', 'Sootopolis Gym',
  // Sinnoh
  'Oreburgh Gym', 'Eterna Gym', 'Veilstone Gym', 'Pastoria Gym', 'Hearthome Gym', 'Canalave Gym', 'Snowpoint Gym', 'Sunyshore Gym',
  // Unova
  'Striaton Gym', 'Nacrene Gym', 'Castelia Gym', 'Nimbasa Gym', 'Driftveil Gym', 'Mistralton Gym', 'Icirrus Gym', 'Opelucid Gym',
  'Aspertia Gym', 'Virbank Gym', 'Humilau Gym',
  // Kalos
  'Santalune Gym', 'Cyllage Gym', 'Shalour Gym', 'Coumarine Gym', 'Lumiose Gym', 'Laverre Gym', 'Anistar Gym', 'Snowbelle Gym',
  // Galar
  'Turffield Stadium', 'Hulbury Stadium', 'Motostoke Stadium', 'Stow-on-Side Stadium', 'Ballonlea Stadium', 'Circhester Stadium',
  'Spikemuth Gym', 'Hammerlocke Stadium',
  // Paldea
  'Cortondo Gym', 'Artazon Gym', 'Levincia Gym', 'Cascarrada Gym', 'Medali Gym', 'Montenevera Gym', 'Alfornada Gym', 'Glaseado Gym',
];

const LEAGUE = [
  'Lorelei', 'Bruno', 'Agatha', 'Lance', 'Will', 'Koga', 'Karen', 'Sidney', 'Phoebe', 'Glacia', 'Drake', 'Steven Stone', 'Wallace',
  'Aaron', 'Bertha', 'Flint', 'Lucian', 'Cynthia', 'Shauntal', 'Grimsley', 'Caitlin', 'Marshal', 'Alder', 'Iris', 'Malva', 'Siebold',
  'Wikstrom', 'Drasna', 'Diantha', 'Hala', 'Olivia', 'Nanu', 'Hapu', 'Molayne', 'Acerola', 'Kahili', 'Kukui', 'Hau', 'Leon',
  'Rika', 'Poppy', 'Larry', 'Hassel', 'Geeta', 'Blue (game)', 'Red (game)', 'Nemona', 'Kieran',
];

const UA = 'PokemonTeamBuilderDataBuild/1.0 (https://github.com/Enrique-Perez-H/pokemon-team-builder; one-off data build)';
const file = (title) => join(dir, `${title.replace(/[^A-Za-z0-9]+/g, '_')}.json`);

let fetched = 0;
for (const title of [...GYMS, ...LEAGUE]) {
  if (existsSync(file(title))) continue;
  const url = `https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  try {
    const body = execFileSync('curl', ['-s', '-m', '60', '-A', UA, url], { encoding: 'utf8', maxBuffer: 20_000_000 });
    const json = JSON.parse(body);
    if (!json.parse) { console.log(`missing: ${title} (${json.error?.code ?? 'no parse'})`); }
    else { writeFileSync(file(title), JSON.stringify({ title, wikitext: json.parse.wikitext })); fetched++; console.log(`ok: ${title}`); }
  } catch (e) {
    console.log(`failed: ${title} (${e.message.split('\n')[0]})`);
  }
  execFileSync('sleep', ['1']);
}
console.log(`done, ${fetched} new pages`);
