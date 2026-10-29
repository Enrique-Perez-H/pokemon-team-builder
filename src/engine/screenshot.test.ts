import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_GENS, getGen, learnableMoves } from './data';
import { norm, parseTeamImage, similarity } from './screenshot';
import type { OcrWord, ParseContext } from './screenshot';

const all = getGen(ALL_GENS);
const ctxFor = (gen = all): ParseContext => ({ gen, learnable: async (s) => (await learnableMoves(all, s)).map((m) => m.name) });

// What Tesseract returned for a team card screenshot (two passes: plain and high contrast).
const fixture = JSON.parse(readFileSync('src/engine/__fixtures__/koga-ocr.json', 'utf8')) as { width: number; height: number; words: { t: string; x0: number; y0: number; x1: number; y1: number; c: number; p: number }[] };
const koga: OcrWord[] = fixture.words.map((w) => ({ text: w.t, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, conf: w.c, pass: w.p }));
const size = { width: fixture.width, height: fixture.height };

describe('text matching', () => {
  it('undoes OCR look-alikes and scores close names high', () => {
    expect(norm('U-Tum')).toBe(norm('U-turn'));
    expect(norm('Cverdrve')).toHaveLength(8);
    expect(similarity('Wicked Blow', 'Nicked Blov')).toBeGreaterThan(0.75);
    expect(similarity('Hydro Pump', 'Fire Blast')).toBeLessThan(0.4);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('reading a team card screenshot', () => {
  it('reads all six Pokémon with their sets', async () => {
    const r = await parseTeamImage(koga, ctxFor(), size);
    expect(r.mons.map((m) => m.species)).toEqual(['Swellow', 'Accelgor', 'Greninja', 'Drapion', 'Iron Valiant', 'Toxtricity']);
    expect(r.mons.map((m) => m.nature)).toEqual(['Timid', 'Timid', 'Timid', 'Adamant', 'Timid', 'Timid']);
    expect(r.mons.map((m) => m.item)).toEqual(['Choice Specs', 'Life Orb', 'Life Orb', 'Choice Scarf', 'Booster Energy', undefined]);
    expect(r.mons.map((m) => m.ability)).toEqual(['Aerilate', 'Sheer Force', 'Battle Bond', 'Sniper', 'Quark Drive', 'Punk Rock']);
    expect(r.mons[0].moves).toEqual(['Boomburst', 'U-turn']);
    expect(r.mons[1].moves).toEqual(['Bug Buzz', 'U-turn', 'Focus Blast', 'Sludge Bomb']);
    expect(r.mons[2].moves).toEqual(['Hydro Pump', 'Water Shuriken', 'Dark Pulse', 'Ice Beam']);
    expect(r.mons[3].moves).toEqual(['Wicked Blow', 'Cross Poison']);
    expect(r.mons[4].moves).toEqual(['Close Combat', 'Spirit Break', 'Knock Off', 'Liquidation']);
    expect(r.mons[5].moves).toEqual(['Boomburst', 'Overdrive', 'Sludge Bomb', 'Hidden Power']);
  });
  it('reads levels, fills gaps from the others, and explains what it could not match exactly', async () => {
    const r = await parseTeamImage(koga, ctxFor(), size);
    expect(r.mons[0].level).toBe(67);
    expect(r.mons.slice(1).every((m) => m.level === 68)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Levels were read for 3 of 6/);
    expect(r.mons[5].notes.join(' ')).toMatch(/Toxtricity-Mega.*not in the data/);
    expect(r.mons[5].notes.join(' ')).toMatch(/Hidden Power Grass/);
    expect(r.mons[0].notes.join(' ')).toMatch(/Aerilate is not a normal ability for Swellow/);
  });
  it('only accepts a believable EV spread', async () => {
    const r = await parseTeamImage(koga, ctxFor(), size);
    for (const m of r.mons) {
      if (!m.evs) continue;
      const total = Object.values(m.evs).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(480);
      expect(total).toBeLessThanOrEqual(510);
      expect(Object.values(m.evs).every((v) => v % 4 === 0 && v <= 252)).toBe(true);
    }
    expect(r.mons[1].evs).toMatchObject({ spa: 252, spe: 252 });
    expect(r.mons[4].evs).toMatchObject({ atk: 252, spe: 252 });
  });
  it('still works from a single, noisier OCR pass', async () => {
    const plain = koga.filter((w) => w.pass === 0).map((w) => ({ ...w, pass: 0 }));
    const r = await parseTeamImage(plain, ctxFor(), size);
    expect(r.mons.map((m) => m.species)).toEqual(['Swellow', 'Accelgor', 'Greninja', 'Drapion', 'Iron Valiant', 'Toxtricity']);
    const moves = r.mons.flatMap((m) => m.moves);
    expect(moves.length).toBeGreaterThanOrEqual(15); // of 20 on the card
    expect(moves).toEqual(expect.arrayContaining(['Hydro Pump', 'Close Combat', 'Boomburst']));
  });
  it('drops moves, items and abilities that the chosen game does not have', async () => {
    const gen4 = getGen(4);
    const r = await parseTeamImage(koga, ctxFor(gen4), size);
    const valiant = r.mons.find((m) => m.species === 'Iron Valiant')!;
    expect(valiant.item).toBeUndefined();
    expect(valiant.notes.join(' ')).toMatch(/Booster Energy does not exist in this game/);
    expect(valiant.moves).toContain('Close Combat');
    const drapion = r.mons.find((m) => m.species === 'Drapion')!;
    expect(drapion.moves).not.toContain('Wicked Blow'); // Gen 8 move
    expect(drapion.notes.join(' ')).toMatch(/Wicked Blow does not exist in this game/);
  });
});

describe('other layouts', () => {
  const w = (text: string, x: number, y: number): OcrWord => ({ text, x0: x, y0: y, x1: x + text.length * 7, y1: y + 10, pass: 0 });
  it('reads a grid of cards (two rows)', async () => {
    const words = [
      w('Garchomp', 100, 20), w('Corviknight', 400, 20),
      w('Jolly', 100, 40), w('Rough', 100, 60), w('Skin', 140, 60), w('Life', 100, 80), w('Orb', 125, 80),
      w('Earthquake', 100, 100), w('Outrage', 100, 120), w('Swords', 100, 140), w('Dance', 150, 140),
      w('Impish', 400, 40), w('Pressure', 400, 60), w('Leftovers', 400, 80), w('Roost', 400, 100), w('Defog', 400, 120), w('Brave', 400, 140), w('Bird', 440, 140),
      w('Gengar', 100, 300), w('Gholdengo', 400, 300),
      w('Timid', 100, 320), w('Shadow', 100, 340), w('Ball', 145, 340), w('Sludge', 100, 360), w('Wave', 140, 360),
      w('Make', 400, 340), w('It', 435, 340), w('Rain', 450, 340), w('Shadow', 400, 360), w('Ball', 445, 360),
    ];
    const r = await parseTeamImage(words, ctxFor(), { width: 700, height: 420 });
    expect(r.mons.map((m) => m.species)).toEqual(['Garchomp', 'Corviknight', 'Gengar', 'Gholdengo']);
    expect(r.mons[0].moves).toEqual(['Earthquake', 'Outrage', 'Swords Dance']);
    expect(r.mons[0].item).toBe('Life Orb');
    expect(r.mons[0].ability).toBe('Rough Skin');
    expect(r.mons[1].moves).toEqual(expect.arrayContaining(['Roost', 'Defog', 'Brave Bird']));
    expect(r.mons[2].moves).toEqual(['Shadow Ball', 'Sludge Wave']); // not mixed up with Gholdengo's column
    expect(r.mons[3].moves).toEqual(['Make It Rain', 'Shadow Ball']);
  });
  it('reads a single Pokémon', async () => {
    const r = await parseTeamImage([w('Gengar', 50, 10), w('Timid', 50, 30), w('Shadow', 50, 50), w('Ball', 95, 50), w('Focus', 50, 70), w('Blast', 90, 70)], ctxFor(), { width: 300, height: 200 });
    expect(r.mons).toHaveLength(1);
    expect(r.mons[0].species).toBe('Gengar');
    expect(r.mons[0].moves).toEqual(['Shadow Ball', 'Focus Blast']);
  });
  it('says so when nothing can be read', async () => {
    expect((await parseTeamImage([], ctxFor())).warnings[0]).toMatch(/No text/);
    const noise = await parseTeamImage([w('lorem', 0, 0), w('ipsum', 50, 0), w('dolor', 100, 0)], ctxFor());
    expect(noise.mons).toEqual([]);
    expect(noise.warnings[0]).toMatch(/No Pokémon names/);
  });
  it('limits to six', async () => {
    const names = ['Garchomp', 'Gengar', 'Gyarados', 'Dragonite', 'Skarmory', 'Blissey', 'Snorlax'];
    const r = await parseTeamImage(names.map((n, i) => w(n, 20 + i * 100, 10)), ctxFor(), { width: 760, height: 100 });
    expect(r.mons).toHaveLength(6);
    expect(r.warnings.join(' ')).toMatch(/only the first 6/);
  });
});
