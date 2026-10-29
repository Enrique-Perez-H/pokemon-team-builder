// Parses Bulbapedia wikitext ({{Party}} + {{Pokémon}} templates) into trainer teams per game.
// Bulbapedia text is CC BY-NC-SA 2.5; see the README for attribution.

/** Bulbapedia `game=` codes → ids from src/engine/games.ts. */
export const GAME_CODES = {
  RGB: ['red-blue'], Y: ['yellow'], Yellow: ['yellow'], GSC: ['gold-silver', 'crystal'],
  RS: ['ruby-sapphire'], E: ['emerald'], FRLG: ['firered-leafgreen'],
  DP: ['diamond-pearl'], Pt: ['platinum'], HGSS: ['heartgold-soulsilver'],
  BW: ['black-white'], W: ['black-white'], Bl: ['black-white'], 'Black and White': ['black-white'], B2W2: ['black-2-white-2'],
  XY: ['x-y'], ORAS: ['omega-ruby-alpha-sapphire'],
  SM: ['sun-moon'], USUM: ['ultra-sun-ultra-moon'], UM: ['ultra-sun-ultra-moon'], SMUSUM: ['sun-moon', 'ultra-sun-ultra-moon'],
  PE: ['lets-go'], SwSh: ['sword-shield'], Sw: ['sword-shield'], Sh: ['sword-shield'],
  BDSP: ['brilliant-diamond-shining-pearl'], SV: ['scarlet-violet'],
};

const NOT_LEAGUE = /battle|frontier|subway|maison|tree|tower|colosseum|pok[eé]athlon|pok[eé]mon stadium|royal|institute|caf[eé]|tournament|factory|facility|arena|dome|training|school/i;
const GYM_CLASS = /^(gym leader|leader|leaders|island kahuna|kahuna|duchess|duke|grand duchess)$/i;
const E4_CLASS = /^elite four$/i;
const CHAMP_CLASS = /^(champion|top champion|bb league champion)$/i;

/** Remove templates like {{color2|000|Brock}} → Brock, [[a|b]] → b, comments and tags. */
export function clean(s) {
  let t = s.replace(/<!--.*?-->/gs, '').replace(/<[^>]+>/g, '');
  for (let i = 0; i < 4; i++) t = t.replace(/\{\{[^{}|]*\|(?:[^{}|]*\|)*?([^{}|]*)\}\}/g, '$1');
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  return t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function fields(body) {
  // Split on "|" outside of {{ }} and [[ ]], then "key = value".
  const out = {};
  let depth = 0, cur = '';
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if (two === '}}' || two === ']]') { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  for (const part of parts) {
    const m = part.match(/^\s*([a-z0-9_]+)\s*=([\s\S]*)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** Template blocks of a given name, with balanced braces. */
function blocks(text, name) {
  const res = [];
  const re = new RegExp(`\\{\\{${name}(?![\\w/])`, 'g');
  let m;
  while ((m = re.exec(text))) {
    let depth = 0, i = m.index;
    for (; i < text.length; i++) {
      if (text.startsWith('{{', i)) { depth++; i++; } else if (text.startsWith('}}', i)) { depth--; i++; if (depth === 0) break; }
    }
    res.push({ start: m.index, end: i + 1, body: text.slice(m.index + 2 + name.length, i - 1) });
  }
  return res;
}

const firstValue = (v) => (v ?? '').split(/[\/,]/)[0].trim();

/** Every party in the page: { name, cls, location, codes, team[] }. */
export function parseParties(text) {
  const parties = [];
  const heads = blocks(text, 'Party');
  for (let h = 0; h < heads.length; h++) {
    const f = fields(heads[h].body);
    const stop = heads[h + 1]?.start ?? text.length;
    const chunk = text.slice(heads[h].end, stop);
    const endAt = chunk.indexOf('{{Party/end}}');
    const region = endAt >= 0 ? chunk.slice(0, endAt) : chunk;
    const team = blocks(region, 'Pokémon').map((b) => {
      const p = fields(b.body);
      const moves = [1, 2, 3, 4].map((i) => clean(p[`move${i}`] ?? '')).filter(Boolean);
      return {
        species: clean(p.pokemon ?? ''),
        ...(p.form ? { form: clean(p.form) } : {}),
        level: Number(firstValue(clean(p.level ?? ''))) || undefined,
        ...(p.gender ? { gender: clean(p.gender) } : {}),
        ...(p.ability ? { ability: clean(p.ability).split('/')[0].trim() } : {}),
        ...(p.held ? { item: clean(p.held) } : {}),
        ...(p.tera ? { tera: clean(p.tera) } : {}),
        moves,
      };
    }).filter((p) => p.species);
    parties.push({
      name: clean(f.name ?? ''), cls: clean(f.class ?? ''), location: clean(f.location ?? ''),
      code: clean(f.game ?? ''), team,
    });
  }
  return parties;
}

/**
 * Teams from one page, grouped per game id. `kind` is what the page is about ('gym' or 'league'); trainers whose class
 * says otherwise (a Champion on a gym page) follow the class. Repeat fights (rematches) get a numbered suffix.
 */
export function collectTrainers(text, kind, league = {}) {
  const per = {};
  const seen = new Map();
  for (const p of parseParties(text)) {
    const ids = GAME_CODES[p.code];
    if (!ids || !p.team.length || !p.name || NOT_LEAGUE.test(p.location) || /#/.test(p.location)) continue;
    const leagueLike = /plateau|league|elite|champion|room|hall|gym|stadium|spikemuth/i.test(p.location);
    if (!leagueLike && !/kahuna/i.test(p.cls)) continue;
    let role;
    if (CHAMP_CLASS.test(p.cls)) role = 'Champion';
    else if (E4_CLASS.test(p.cls)) role = 'Elite Four';
    else if (GYM_CLASS.test(p.cls)) role = /kahuna/i.test(p.cls) ? 'Kahuna' : 'Gym Leader';
    else if (kind === 'gym' && /gym|stadium/i.test(p.location)) role = 'Gym Leader';
    else if (kind === 'league' && league[p.name] && /plateau|league|elite|champion|room|hall/i.test(p.location)) role = league[p.name];
    else continue;
    for (const id of ids) {
      const key = `${id}|${p.name}|${p.location}`;
      const n = seen.get(key)?.n ?? 0;
      const first = seen.get(key)?.size ?? p.team.length;
      if (n && p.team.length < first) continue;
      seen.set(key, { n: n + 1, size: first });
      (per[id] ??= []).push({
        name: p.name, role, location: p.location,
        ...(n ? { battle: `Battle ${n + 1}` } : {}),
        team: p.team,
      });
    }
  }
  return per;
}
