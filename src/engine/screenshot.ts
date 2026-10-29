import { ALL_GENS, STATS, getGen, speciesPool } from './data';
import type { Generation, StatKey } from './data';
import { hasNatures, suggestBuild } from './sets';
import type { Build } from './sets';
import type { Slot } from './team';

/** One word found by OCR, with its box in the image's own pixel coordinates. */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** OCR confidence 0–100 (informational). */
  conf?: number;
  /** Which OCR pass produced the word. Passes read the same text differently, so their lines are kept apart. */
  pass?: number;
}

/** A Pokémon read from an image. Only `species` is required; everything else is filled in when it could be read. */
export interface ParsedMon {
  /** The species as named in the dex. */
  species: string;
  /** What the image said (before correcting spelling). */
  read: string;
  level?: number;
  nature?: string;
  ability?: string;
  item?: string;
  moves: string[];
  /** Only set when a complete, plausible spread was read. */
  evs?: Record<StatKey, number>;
  /** Things the user should double-check. */
  notes: string[];
  /** How sure we are about the species, 0–1. */
  score: number;
}

export interface ParseResult {
  mons: ParsedMon[];
  warnings: string[];
}

export interface ParseContext {
  /** The generation or game being used: moves and items it does not have are dropped. */
  gen: Generation;
  /** Names of the moves a species can learn (used first, so garbled moves resolve to real ones). */
  learnable: (species: string) => Promise<string[]>;
}

// ---------- text similarity ----------

/**
 * Lowercase letters and digits only, with the look-alike mix-ups OCR makes undone: digits for letters (0/o, 1/l, 5/s) and
 * letter pairs for one letter (rn/m, vv/w). It is applied to both sides of every comparison, so "U-turn" and "U-Tum" meet.
 */
export const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/0/g, 'o').replace(/1/g, 'l').replace(/5/g, 's').replace(/rn/g, 'm').replace(/vv/g, 'w');

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (!n || !m) return Math.max(n, m);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[m];
}

/** 1 for identical, falling towards 0 as more characters differ. */
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  // Short fragments of a longer name (a move cut off by an icon) count for a little, never for a lot.
  return 1 - distance(x, y) / Math.max(x.length, y.length);
}

interface Entry {
  name: string;
  key: string;
}
const entries = (names: string[]): Entry[] => names.map((name) => ({ name, key: norm(name) }));

function best(text: string, dict: Entry[]): { name: string; score: number } | null {
  const t = norm(text);
  if (t.length < 3) return null;
  let top: { name: string; score: number } | null = null;
  for (const e of dict) {
    if (Math.abs(e.key.length - t.length) > Math.max(3, e.key.length * 0.4)) continue;
    const score = 1 - distance(t, e.key) / Math.max(t.length, e.key.length);
    if (!top || score > top.score) top = { name: e.name, score };
  }
  return top;
}

// ---------- dictionaries ----------

interface Dicts {
  species: Entry[];
  moves: Entry[];
  items: Entry[];
  abilities: Entry[];
  natures: string[];
}

let dicts: Dicts | null = null;

function dictionaries(): Dicts {
  if (dicts) return dicts;
  const lookup = getGen(ALL_GENS);
  dicts = {
    species: entries(speciesPool(lookup, true).map((s) => s.name)),
    moves: entries([...lookup.moves].map((m) => m.name)),
    items: entries([...lookup.items].map((i) => i.name)),
    abilities: entries([...lookup.abilities].map((a) => a.name)),
    natures: [...getGen(9).natures].map((n) => n.name),
  };
  return dicts;
}

// ---------- geometry helpers ----------

const cx = (w: OcrWord) => (w.x0 + w.x1) / 2;
const cy = (w: OcrWord) => (w.y0 + w.y1) / 2;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

interface SpeciesHit {
  species: string;
  read: string;
  score: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  yc: number;
}

/** Group words into lines top to bottom, each line left to right. */
function toLines(words: OcrWord[], tol: number): OcrWord[][] {
  const sorted = [...words].sort((a, b) => cy(a) - cy(b));
  const lines: OcrWord[][] = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(median(l.map(cy)) - cy(w)) <= tol);
    if (line) line.push(w);
    else lines.push([w]);
  }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0)).sort((a, b) => median(a.map(cy)) - median(b.map(cy)));
}

// ---------- species ----------

const MEGA_SUFFIX = /[-\s]?(mega|primal)([-\s]?[xy])?$/i;

function resolveSpecies(read: string): { species: string; score: number; note?: string } | null {
  const d = dictionaries();
  const cleaned = read.replace(/[^A-Za-z0-9\-.' :é]/g, '').trim();
  if (norm(cleaned).length < 4) return null;
  const hit = best(cleaned, d.species);
  const threshold = norm(cleaned).length <= 5 ? 0.99 : 0.8;
  if (hit && hit.score >= threshold) return { species: hit.name, score: hit.score };
  // A form we do not have (for example a brand-new Mega): fall back to the base species and say so.
  if (MEGA_SUFFIX.test(cleaned)) {
    const base = best(cleaned.replace(MEGA_SUFFIX, ''), d.species);
    if (base && base.score >= 0.85) {
      return { species: base.name, score: base.score * 0.9, note: `“${cleaned}” is not in the data; used ${base.name}.` };
    }
  }
  return null;
}

function findSpeciesHits(words: OcrWord[], lineH: number): SpeciesHit[] {
  const hits: SpeciesHit[] = [];
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  const consider = (parts: OcrWord[]) => {
    const read = parts.map((p) => p.text).join(' ');
    const r = resolveSpecies(read);
    if (!r) return;
    hits.push({
      species: r.species, read, score: r.score,
      x0: Math.min(...parts.map((p) => p.x0)), x1: Math.max(...parts.map((p) => p.x1)),
      y0: Math.min(...parts.map((p) => p.y0)), y1: Math.max(...parts.map((p) => p.y1)),
      yc: median(parts.map(cy)),
    });
  };
  for (const w of sorted) {
    consider([w]);
    // Two-word names ("Iron Valiant", "Great Tusk"): the next word on the same line, close by.
    const next = sorted.find((o) => o !== w && o.x0 >= w.x1 - 2 && o.x0 - w.x1 < lineH * 2 && Math.abs(cy(o) - cy(w)) < lineH * 0.6);
    if (next) consider([w, next]);
  }
  // A longer match replaces any shorter match it contains ("Iron Valiant" over "Valiant").
  return hits.filter((h) => !hits.some((o) => o !== h && o.x0 <= h.x0 + 1 && o.x1 >= h.x1 - 1 && (o.x1 - o.x0) > (h.x1 - h.x0) && o.score >= h.score - 0.05 && Math.abs(o.yc - h.yc) < lineH));
}

// ---------- per-Pokémon reading ----------

interface Cell {
  hit: SpeciesHit;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The six rows under "BASE STATS", read in order (HP, Atk, Def, SpA, SpD, Spe); the number on the right is the EV. */
function readEvs(lines: OcrWord[][], cell: Cell, headerY: number | null): Record<StatKey, number> | undefined {
  if (headerY === null) return undefined;
  const evColumn = cell.left + (cell.right - cell.left) * 0.55;
  const rows: OcrWord[][] = [];
  for (const line of lines) {
    if (median(line.map(cy)) <= headerY + 1) continue;
    // The final-speed line ("SPEED STAT: 258") ends the table, when OCR read it well enough to tell.
    if (line.some((w) => similarity(w.text, 'speed') >= 0.7 || similarity(w.text, 'stat') >= 0.75)) break;
    const labelled = line.some((w) => /^[A-Za-z]{2,5}$/.test(w.text) && STATS.some((l) => similarity(w.text, l) >= 0.66));
    if (labelled || line.some((w) => /\d/.test(w.text))) rows.push(line);
  }
  if (rows.length < 6) return undefined;
  rows.length = 6;
  // Each row must carry the label expected at its position, or a missed row has shifted the numbers onto the wrong stat.
  const expected = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const wrong = rows.filter((row, i) => {
    const label = row.find((w) => /^[A-Za-z]{2,5}$/.test(w.text));
    return !!label && similarity(label.text, expected[i]) < 0.5 && !(expected[i] === 'atk' && similarity(label.text, 'aik') >= 0.5);
  });
  if (wrong.length) return undefined;
  const evs = {} as Record<StatKey, number>;
  STATS.forEach((k, i) => {
    const ev = [...rows[i]].reverse().find((w) => /^\d{1,3}$/.test(w.text) && cx(w) >= evColumn && Number(w.text) % 4 === 0 && Number(w.text) <= 252);
    evs[k] = ev ? Number(ev.text) : 0;
  });
  const total = STATS.reduce((a, k) => a + evs[k], 0);
  // Only trust a spread that looks like a real one (a full or nearly full investment).
  return total >= 480 && total <= 510 ? evs : undefined;
}

async function readCell(cell: Cell, words: OcrWord[], ctx: ParseContext, lineH: number): Promise<ParsedMon> {
  const d = dictionaries();
  const { species, read, score } = cell.hit;
  const note = resolveSpecies(read)?.note;
  const mon: ParsedMon = { species, read, moves: [], notes: note ? [note] : [], score };

  const inside = words.filter((w) => cx(w) >= cell.left && cx(w) <= cell.right && cy(w) > cell.hit.y1 + 1 && cy(w) < cell.bottom);
  const passes = [...new Set(inside.map((w) => w.pass ?? 0))];
  // Lines are built per OCR pass: two passes interleave their words, which would split names like "Wicked Blow".
  const passLines = passes.map((p) => toLines(inside.filter((w) => (w.pass ?? 0) === p), Math.max(5, lineH * 0.55)));

  const sp = getGen(ALL_GENS).species.get(species);
  const own = sp ? entries([...new Set(Object.values(sp.abilities))]) : [];
  const learn = entries(await ctx.learnable(species).catch(() => []));

  // Level: a small number just under the name.
  const nearName = passLines.flatMap((ls) => ls.slice(0, 2).flat()).filter((w) => /^\d{1,3}$/.test(w.text) && Number(w.text) >= 1 && Number(w.text) <= 100);
  if (nearName.length) mon.level = Number(nearName[0].text);

  const moves: { name: string; score: number; y: number }[] = [];
  let natureScore = 0;
  let abilityScore = 0;
  let itemScore = 0;
  let abilityGlobal = false;
  const natureEntries = entries(d.natures);
  /** Short names must match almost exactly; long ones tolerate more OCR damage. */
  const moveFloor = (name: string, base: number) => (norm(name).length >= 10 ? base : norm(name).length >= 7 ? base + 0.1 : base + 0.2);

  const evCandidates: (Record<StatKey, number> | undefined)[] = [];
  for (const lines of passLines) {
    // Everything from the "BASE STATS" header down is the stat table, not moves or items.
    const header = lines.find((l) => l.some((w) => similarity(w.text, 'basestats') >= 0.75 || norm(w.text) === 'base'));
    const headerY = header ? Math.min(...header.map((w) => w.y0)) : null;
    evCandidates.push(readEvs(lines, cell, headerY !== null ? headerY : null));
    for (const line of lines) {
      const y = median(line.map(cy));
      if (headerY !== null && y >= headerY - 1) continue;
      // Hidden Power is written "HP Grass" on many cards.
      const hp = line.map((w) => w.text).join(' ').match(/\bh[pf]\s+(bug|dark|dragon|electric|fighting|fire|flying|ghost|grass|ground|ice|poison|psychic|rock|steel|water)\b/i);
      if (hp) {
        moves.push({ name: 'Hidden Power', score: 0.95, y });
        mon.notes.push(`Hidden Power ${hp[1][0].toUpperCase()}${hp[1].slice(1).toLowerCase()} was read; the type is not kept.`);
        continue;
      }
      // Every run of up to four neighbouring words in the line is a candidate (icons and noise sit between names).
      const spans: string[] = [];
      for (let i = 0; i < line.length; i++) {
        for (let j = i; j < Math.min(line.length, i + 4); j++) spans.push(line.slice(i, j + 1).map((w) => w.text).join(' '));
      }
      let top: { kind: 'nature' | 'ability' | 'item' | 'move'; name: string; score: number; global?: boolean } | null = null;
      const lineLen = Math.max(1, norm(line.map((w) => w.text).join('')).length);
      let coverage = 1;
      const offer = (kind: 'nature' | 'ability' | 'item' | 'move', name: string, score: number, floor: number, global = false) => {
        // Natures and own abilities are small lists, so they win ties; names that fill more of the line beat ones that only
        // cover part of it ("Brave Bird" the move over "Brave" the nature, "Sludge Bomb" over "Sludge").
        const weighted = score + (kind === 'nature' ? 0.03 : kind === 'ability' ? 0.03 : kind === 'item' ? 0.02 : 0) + coverage * 0.12 + norm(name).length * 0.0004;
        if (score >= floor && (!top || weighted > top.score)) top = { kind, name, score: weighted, global };
      };
      for (const text of spans) {
        const len = norm(text).length;
        if (len < 3) continue;
        coverage = Math.min(1, len / lineLen);
        // A nature is a line of its own; a name that merely starts a longer line is something else.
        if (text.split(' ').length === 1 && coverage >= 0.7) {
          const n = best(text, natureEntries);
          if (n) offer('nature', n.name, n.score, 0.8);
        }
        const a = best(text, own);
        if (a) offer('ability', a.name, a.score, moveFloor(a.name, 0.55));
        // Matches against the whole dictionary (not this Pokémon's own list) must fill most of the line and be long enough
        // to mean something, or OCR noise ("Rage", "Slam") turns into moves.
        const wide = coverage >= 0.75;
        const ga = wide ? best(text, d.abilities) : null;
        if (ga && norm(ga.name).length >= 5) offer('ability', ga.name, ga.score, moveFloor(ga.name, 0.74), true);
        const i = best(text, d.items);
        if (i) offer('item', i.name, i.score, moveFloor(i.name, 0.68));
        const m = best(text, learn);
        if (m) offer('move', m.name, m.score, moveFloor(m.name, 0.5));
        const gm = wide ? best(text, d.moves) : null;
        if (gm && norm(gm.name).length >= 5) offer('move', gm.name, gm.score, moveFloor(gm.name, 0.74));
      }
      if (!top) continue;
      const t = top as { kind: 'nature' | 'ability' | 'item' | 'move'; name: string; score: number; global?: boolean };
      if (t.kind === 'nature' && t.score > natureScore) { mon.nature = t.name; natureScore = t.score; }
      else if (t.kind === 'ability' && t.score > abilityScore) { mon.ability = t.name; abilityScore = t.score; abilityGlobal = !!t.global; }
      else if (t.kind === 'item' && t.score > itemScore) { mon.item = t.name; itemScore = t.score; }
      else if (t.kind === 'move') moves.push({ name: t.name, score: t.score, y });
    }
  }

  // Each pass read the same lines: keep each move once, then the best four in reading order.
  const seen = new Map<string, { name: string; score: number; y: number }>();
  for (const m of moves) if (!seen.has(m.name) || m.score > seen.get(m.name)!.score) seen.set(m.name, m);
  const unique = [...seen.values()];
  // "Sludge" read from the start of "Sludge Bomb" is not a second move.
  const real = unique.filter((m) => !unique.some((o) => o !== m && norm(o.name).startsWith(norm(m.name)) && norm(o.name).length > norm(m.name).length));
  mon.moves = real.sort((a, b) => b.score - a.score).slice(0, 4).sort((a, b) => a.y - b.y).map((m) => m.name);
  mon.notes = [...new Set(mon.notes)];

  if (mon.ability && abilityGlobal && sp && !Object.values(sp.abilities).includes(mon.ability)) {
    mon.notes.push(`${mon.ability} is not a normal ability for ${species}.`);
  }
  mon.evs = evCandidates.find((e) => !!e);

  // Drop what the chosen game does not have, and say so.
  const gen = ctx.gen;
  mon.moves = mon.moves.filter((m) => {
    if (gen.moves.get(m)) return true;
    mon.notes.push(`${m} does not exist in this game.`);
    return false;
  });
  if (mon.item && gen.num >= 2 && !gen.items.get(mon.item)) {
    mon.notes.push(`${mon.item} does not exist in this game; the item was left out.`);
    mon.item = undefined;
  }
  if (mon.ability && gen.num >= 3 && !gen.abilities.get(mon.ability)) {
    mon.notes.push(`${mon.ability} does not exist in this game.`);
    mon.ability = undefined;
  }
  return mon;
}

// ---------- the whole image ----------

/**
 * Read a team from OCR words. The names of the Pokémon sit on one row; each name defines a column (or, for a grid of
 * cards, a cell), and everything below it up to the next row belongs to that Pokémon.
 */
export async function parseTeamImage(words: OcrWord[], ctx: ParseContext, size?: { width: number; height: number }): Promise<ParseResult> {
  const clean = words.filter((w) => w.text.trim() && /[A-Za-z0-9]/.test(w.text));
  const warnings: string[] = [];
  if (!clean.length) return { mons: [], warnings: ['No text was found in the image.'] };

  const lineH = median(clean.map((w) => w.y1 - w.y0)) || 10;
  const width = size?.width ?? Math.max(...clean.map((w) => w.x1));
  let hits = findSpeciesHits(clean, lineH);
  if (!hits.length) return { mons: [], warnings: ['No Pokémon names were recognised. Try a larger or sharper picture.'] };

  // The name row is where most recognised names line up; stray matches elsewhere are noise.
  const tol = Math.max(10, lineH * 1.2);
  const bands: SpeciesHit[][] = [];
  for (const h of [...hits].sort((a, b) => a.yc - b.yc)) {
    const band = bands.find((b) => Math.abs(median(b.map((x) => x.yc)) - h.yc) <= tol);
    if (band) band.push(h);
    else bands.push([h]);
  }
  // Two passes read the same name twice: keep the best reading of each place.
  const dedupe = (band: SpeciesHit[]) => {
    const out: SpeciesHit[] = [];
    for (const h of [...band].sort((a, b) => b.score - a.score)) {
      if (!out.some((o) => Math.abs((o.x0 + o.x1) / 2 - (h.x0 + h.x1) / 2) < Math.max(o.x1 - o.x0, h.x1 - h.x0) * 0.6)) out.push(h);
    }
    return out.sort((a, b) => a.x0 - b.x0);
  };
  let rows = bands.map(dedupe);
  const strongest = Math.max(...rows.map((r) => r.length));
  rows = rows.filter((r) => r.length >= 2 || strongest === 1);
  if (!rows.length) rows = [dedupe(bands.sort((a, b) => b.length - a.length)[0])];
  hits = rows.flat();

  const cells: Cell[] = [];
  rows.forEach((row, r) => {
    const centers = row.map((h) => (h.x0 + h.x1) / 2);
    const gaps = centers.slice(1).map((c, i) => c - centers[i]);
    const gap = gaps.length ? median(gaps) : width;
    const top = Math.min(...row.map((h) => h.y0));
    const nextTop = rows[r + 1] ? Math.min(...rows[r + 1].map((h) => h.y0)) : Infinity;
    row.forEach((hit, i) => {
      const left = i === 0 ? centers[i] - gap / 2 : (centers[i - 1] + centers[i]) / 2;
      const right = i === row.length - 1 ? centers[i] + gap / 2 : (centers[i] + centers[i + 1]) / 2;
      cells.push({ hit, left: Math.max(0, left), right, top, bottom: nextTop });
    });
  });

  const mons: ParsedMon[] = [];
  for (const cell of cells) mons.push(await readCell(cell, clean, ctx, lineH));

  // Levels the OCR missed take the level the other Pokémon share (a gym leader's team is usually one level).
  const known = mons.map((m) => m.level).filter((l): l is number => !!l);
  if (known.length >= 2) {
    const common = median(known);
    const missing = mons.filter((m) => !m.level);
    for (const m of missing) m.level = common;
    if (missing.length) warnings.push(`Levels were read for ${known.length} of ${mons.length} Pokémon; the rest use level ${common}.`);
  }
  if (mons.length > 6) {
    warnings.push(`${mons.length} Pokémon were found; only the first 6 are used.`);
    mons.length = 6;
  }
  return { mons, warnings };
}

/**
 * A team slot from a Pokémon read off an image. Whatever the image gave (level, nature, item, ability, moves, EVs) is
 * used; anything it did not is filled with the usual suggested build for that Pokémon.
 */
export function slotFromParsed(gen: Generation, m: ParsedMon): Slot | null {
  const sp = gen.species.get(m.species);
  if (!sp) return null;
  const moves = m.moves.filter((n) => gen.moves.get(n)).slice(0, 4);
  const objs = moves.map((n) => gen.moves.get(n)!);
  const base = suggestBuild(gen, sp, objs, m.ability);
  const build: Build = {
    ...base,
    level: m.level ?? 100,
    nature: hasNatures(gen) && m.nature ? m.nature : base.nature,
    item: gen.num >= 2 ? m.item ?? base.item : undefined,
    evs: m.evs ?? base.evs,
    ability: m.ability ?? base.ability,
  };
  return { species: sp.name, ability: m.ability, moves, build };
}
