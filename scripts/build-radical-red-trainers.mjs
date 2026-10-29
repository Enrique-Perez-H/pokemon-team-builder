// node scripts/build-radical-red-trainers.mjs <cache dir> <output file>
// Reads boss pages saved from https://radicalredtracker.com/bosses/<boss> (Radical Red 4.1 data, Normal mode) and
// writes the gym leaders, Elite Four and Champion teams. Fetch the pages first with scripts/fetch-radical-red-pages.sh.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [cache, out] = process.argv.slice(2);
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const PART = { 'Kanto Leaders': 'Gym Leader', 'Johto Leaders': 'Gym Leader', 'Kanto Rematch': 'Gym Leader', 'Indigo League': null };
const EV_KEY = { HP: 'hp', ATK: 'atk', DEF: 'def', SPA: 'spa', SPD: 'spd', SPE: 'spe' };

function parseMon(html, base) {
  const name = text(html.match(/class="name">(.*?)<\/div>/s)[1]);
  const lv = text(html.match(/class="muted">Lv (.*?)<\/div>/s)[1]);
  const rel = lv.match(/Highest Lv\s*(-\d+)?/);
  const dd = (k) => { const m = html.match(new RegExp(`<dt>${k}</dt><dd>(.*?)</dd>`, 's')); return m ? text(m[1]) : undefined; };
  const evs = dd('EVs') && Object.fromEntries(dd('EVs').split('/').map((p) => { const [n, k] = p.trim().split(/\s+/); return [EV_KEY[k], Number(n)]; }));
  return {
    species: name,
    level: rel ? Math.max(1, base + Number(rel[1] ?? 0)) : Number(lv),
    ability: dd('Ability'), item: dd('Item'), nature: dd('Nature'), ...(evs ? { evs } : {}),
    moves: [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => text(m[1])),
  };
}

const trainers = [];
for (const f of readdirSync(cache).sort()) {
  const page = readFileSync(join(cache, f), 'utf8');
  const start = page.indexOf('<section class="p-default">');
  const section = page.slice(start, page.indexOf('</section>', start));
  // A page holds several fights, each introduced by an <h2>; a fight may hold several teams in <details> blocks.
  for (const chunk of section.split(/(?=<h2[ >])/).slice(1)) {
    const title = text(chunk.match(/<h2[^>]*>(.*?)<\/h2>/s)[1].replace(/Three teams.*$/, ''));
    for (const seg of chunk.split(/(?=<div class="card">)/).slice(1)) {
      if (!seg.includes('<div class="mons">')) continue;
      const variant = [...chunk.slice(0, chunk.indexOf(seg)).matchAll(/<summary>(.*?)<\/summary>/g)].pop()?.[1];
      const rows = Object.fromEntries([...seg.slice(0, seg.indexOf('</table>')).matchAll(/<th>(.*?)<\/th><td[^>]*>(.*?)<\/td>/gs)].map((r) => [text(r[1]), text(r[2])]));
      const part = rows['Part of'] ?? rows.Fight ?? '';
      const [who, where = ''] = title.split(' — ');
      const champion = who === 'The Champion';
      const elite = /Elite Four/.test(where);
      if (!champion && !elite && !/Leaders|Rematch/.test(part)) continue;
      const cap = Number(rows['Level cap']) || undefined;
      const monsHtml = seg.slice(seg.indexOf('<div class="mons">')).split('<div class="mon">').slice(1)
        .map((h) => h.slice(0, h.indexOf('</ul>') + 5));
      const numeric = monsHtml.map((h) => Number(h.match(/class="muted">Lv (\d+)</)?.[1])).filter(Boolean);
      const base = cap ?? (numeric.length ? Math.max(...numeric) : 75);
      const role = champion ? 'Champion' : elite ? 'Elite Four' : 'Gym Leader';
      const rematch = /Rematch/.test(part);
      const battle = [rematch ? 'Rematch' : '', elite && /\(/.test(where) ? where.replace(/^.*\(|\)$/g, '') : '', variant ? text(variant) : '',
        !elite && !champion && /\(/.test(where) ? where.replace(/^.*\(|\)$/g, '') : ''].filter(Boolean).join(', ');
      trainers.push({
        name: champion ? 'Rival (Champion)' : who, role, location: champion || elite ? 'Indigo League' : rematch ? 'Kanto' : where.replace(/\s*\(.*$/, ''),
        ...(battle ? { battle } : {}), team: monsHtml.map((h) => parseMon(h, base)),
      });
    }
  }
}
const ORDER = ['Gym Leader', 'Elite Four', 'Champion'];
trainers.sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
writeFileSync(out, JSON.stringify(trainers));
console.log(trainers.length, 'fights');
for (const t of trainers) console.log(t.role.padEnd(11), t.name, '|', t.location, '|', t.battle ?? '', t.team.length, t.team.map((x) => x.level).join(','));
