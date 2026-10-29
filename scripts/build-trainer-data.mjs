// node scripts/build-trainer-data.mjs <cache dir from fetch-trainer-pages.mjs> <output dir>
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectTrainers } from './trainer-parser.mjs';

const [cache, out] = process.argv.slice(2);
const LEAGUE_ROLE = {};
const E4 = ['Lorelei','Bruno','Agatha','Will','Koga','Karen','Sidney','Phoebe','Glacia','Drake','Aaron','Bertha','Flint','Lucian','Shauntal','Grimsley','Caitlin','Marshal','Malva','Siebold','Wikstrom','Drasna','Hala','Olivia','Acerola','Kahili','Molayne','Rika','Poppy','Larry','Hassel','Nanu','Hapu'];
const CH = ['Lance','Steven Stone','Wallace','Cynthia','Alder','Iris','Diantha','Kukui','Leon','Geeta','Blue','Red'];
for (const n of E4) LEAGUE_ROLE[n] = 'Elite Four';
for (const n of CH) LEAGUE_ROLE[n] = 'Champion';

const merged = {};
for (const f of readdirSync(cache).sort()) {
  const { title, wikitext } = JSON.parse(readFileSync(join(cache, f), 'utf8'));
  const kind = /Gym|Stadium$/.test(title) ? 'gym' : 'league';
  const per = collectTrainers(wikitext, kind, LEAGUE_ROLE);
  for (const [id, list] of Object.entries(per)) (merged[id] ??= []).push(...list);
}
mkdirSync(out, { recursive: true });
const ROLE_ORDER = ['Gym Leader', 'Kahuna', 'Elite Four', 'Champion'];
const peak = (t) => Math.max(...t.team.map((m) => m.level ?? 0));
const LANCE_E4 = new Set(['red-blue', 'yellow', 'firered-leafgreen', 'lets-go']);
for (const [id, list] of Object.entries(merged)) {
  for (const t of list) if (t.name === 'Lance' && LANCE_E4.has(id)) t.role = 'Elite Four';
  list.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || peak(a) - peak(b) || (a.battle ?? '').localeCompare(b.battle ?? ''));
  writeFileSync(join(out, `${id}.json`), JSON.stringify(list));
  const roles = list.reduce((a, t) => ((a[t.role] = (a[t.role] ?? 0) + 1), a), {});
  console.log(id.padEnd(34), list.length, JSON.stringify(roles));
}
