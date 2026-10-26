import { describe, expect, it } from 'vitest';
import { getGen, speciesPool, learnableMoves } from './data';
import { defenseTable, coverageTable } from './analysis';
import { newRule, validateTeam, wouldViolate } from './rules';
import { suggestPicks } from './suggest';
import type { Member } from './types';

const gen = getGen(9);
const mon = (name: string, ability?: string, moves: string[] = []): Member => ({
  species: gen.species.get(name)!,
  ability,
  moves: moves.map((m) => gen.moves.get(m)!),
});

describe('defense', () => {
  it('computes dual-type multipliers and ability immunities', () => {
    const t = defenseTable(gen, [mon('Garchomp'), mon('Gengar', 'Levitate')]);
    const ice = t.find((r) => r.type === 'Ice')!;
    expect(ice.perMember[0]).toBe(4);
    expect(t.find((r) => r.type === 'Ground')!.perMember).toEqual([1, 0]);
    expect(t.find((r) => r.type === 'Electric')!.perMember[0]).toBe(0);
  });
  it('has no Fairy before gen 6', () => {
    expect(defenseTable(getGen(5), []).some((r) => r.type === 'Fairy')).toBe(false);
  });
});

describe('coverage', () => {
  it('uses chosen moves, falling back to STAB', () => {
    const c = coverageTable(gen, [mon('Garchomp', undefined, ['Earthquake'])]);
    expect(c.find((r) => r.type === 'Steel')!.best).toBe(2);
    expect(c.find((r) => r.type === 'Flying')!.best).toBe(0);
    const stab = coverageTable(gen, [mon('Garchomp')]);
    expect(stab.find((r) => r.type === 'Dragon')!.sources[0].assumed).toBe(true);
  });
});

describe('rules', () => {
  const water = newRule('allowed_types');
  water.params.types = ['Water'];
  it('filters by type and validates teams', () => {
    const v = validateTeam([water], [gen.species.get('Garchomp')!]);
    expect(v).toHaveLength(1);
    expect(wouldViolate([water], [null], gen.species.get('Vaporeon')!, 0)).toEqual([]);
  });
  it('enforces generation, max-per-type and species clause', () => {
    const g = newRule('origin_gens');
    g.params.gens = [1];
    expect(validateTeam([g], [gen.species.get('Garchomp')!])).toHaveLength(1);
    const m = newRule('max_per_type');
    m.params.max = 1;
    const team = [gen.species.get('Squirtle')!, gen.species.get('Vaporeon')!];
    expect(validateTeam([m], team)[0].slots).toEqual([0, 1]);
    const sc = newRule('species_clause');
    expect(validateTeam([sc], [team[0], team[0]])).toHaveLength(1);
  });
  it('disabled rules are ignored', () => {
    expect(validateTeam([{ ...water, enabled: false }], [gen.species.get('Garchomp')!])).toEqual([]);
  });
});

describe('data', () => {
  it('builds species pools and learnsets per generation', async () => {
    expect(speciesPool(getGen(1), false)).toHaveLength(151);
    expect(speciesPool(gen, false).length).toBeGreaterThan(600);
    const moves = await learnableMoves(gen, 'Garchomp');
    expect(moves.map((m) => m.name)).toContain('Earthquake');
    const g1 = await learnableMoves(getGen(1), 'Pikachu');
    expect(g1.map((m) => m.name)).toContain('Thunderbolt');
    expect(g1.length).toBeLessThan(moves.length + 200);
  });
});

describe('suggestions', () => {
  it('prefers picks that patch a stacked weakness', () => {
    const slots = ['Charizard', 'Talonflame', 'Corviknight'].map((n) => gen.species.get(n)!);
    const team = slots.map((s) => ({ species: s, moves: [] }));
    const picks = suggestPicks(gen, [], [...slots, null, null, null], team, 3, false, 5);
    expect(picks).toHaveLength(5);
    expect(picks[0].reasons.join()).toMatch(/Resists/);
  });
});

import { optimizeTeam, scoreSpecies } from './optimize';
import { autoMoves } from './moves';

describe('optimizer', () => {
  const none = Array(6).fill(null);
  it('builds a legal, balanced team and respects rules', () => {
    const noLeg = newRule('no_legendaries');
    const fe = newRule('fully_evolved');
    const rules = [newRule('species_clause'), noLeg, fe];
    const t0 = Date.now();
    const res = optimizeTeam({ gen, rules, locked: none, megas: false });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(8000);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].slots).toHaveLength(6);
    expect(validateTeam(rules, res[0].slots)).toEqual([]);
    expect(res[0].score).toBeGreaterThanOrEqual(res[res.length - 1].score);
    // A decent team should not share an unresisted weakness across most members.
    const worst = Math.max(...defenseTable(gen, res[0].slots.map((s) => ({ species: s, moves: [] }))).map((r) => r.weak - r.resist - r.immune));
    expect(worst).toBeLessThanOrEqual(2);
  });
  it('keeps locked Pokémon and mono-type rules', () => {
    const water = newRule('allowed_types');
    water.params.types = ['Water'];
    const locked = [gen.species.get('Vaporeon')!, null, null, null, null, null];
    const res = optimizeTeam({ gen, rules: [newRule('species_clause'), water], locked, megas: false });
    expect(res[0].slots[0].name).toBe('Vaporeon');
    expect(res[0].slots.every((s) => s.types.includes('Water'))).toBe(true);
  });
  it('beats a naive same-type team', () => {
    const res = optimizeTeam({ gen, rules: [newRule('species_clause')], locked: none, megas: false });
    const naive = ['Charizard', 'Arcanine', 'Talonflame', 'Ceruledge', 'Skeledirge', 'Armarouge'].map((n) => gen.species.get(n)!);
    expect(res[0].score).toBeGreaterThan(scoreSpecies(gen, naive).total + 5);
  });
  it('returns nothing when rules cannot be satisfied', () => {
    const impossible = newRule('bst_range');
    impossible.params.min = 790;
    impossible.params.max = 800;
    expect(optimizeTeam({ gen, rules: [impossible], locked: none, megas: false })).toEqual([]);
  });
});

describe('autoMoves', () => {
  it('picks STAB and coverage attacks', async () => {
    const moves = await autoMoves(gen, gen.species.get('Garchomp')!);
    expect(moves).toHaveLength(4);
    const types = moves.map((m) => gen.moves.get(m)!.type);
    expect(types).toContain('Ground');
    expect(types).toContain('Dragon');
    expect(new Set(types).size).toBe(4);
  });
});

import { ALL_GENS, genId } from './data';

describe('every generation', () => {
  const all = getGen(ALL_GENS);
  it('includes Pokémon and moves from all generations with modern mechanics', async () => {
    const pool = speciesPool(all, false);
    expect(pool.length).toBeGreaterThan(speciesPool(gen, false).length + 150);
    expect(pool.find((s) => s.name === 'Pidgeot')).toBeTruthy();
    expect(speciesPool(gen, false).find((s) => s.name === 'Pidgeot')).toBeFalsy();
    expect(defenseTable(all, []).some((r) => r.type === 'Fairy')).toBe(true);
    const moves = await learnableMoves(all, 'Pidgeot');
    expect(moves.length).toBeGreaterThan(30);
  });
  it('does not share caches with Gen 9', () => {
    expect(genId(all)).toBe(0);
    expect(genId(gen)).toBe(9);
  });
  it('optimizes across every generation', () => {
    const res = optimizeTeam({ gen: all, rules: [newRule('species_clause'), newRule('no_legendaries')], locked: Array(6).fill(null), megas: false });
    expect(res[0].slots).toHaveLength(6);
  });
});

import { bestAnswers, counterObjective, fighterFromMember, matchup, matchupMatrix, topCounters } from './counter';
import type { Foe } from './counter';

describe('counters', () => {
  const foe = (name: string, attackTypes: any[]): Foe => ({ species: gen.species.get(name)!, attackTypes });
  const fighter = (name: string) => fighterFromMember(gen, { species: gen.species.get(name)!, moves: [] });

  it('scores type advantages in the right direction', () => {
    const charizard = foe('Charizard', ['Fire', 'Flying']);
    const vaporeon = matchup(gen, fighter('Vaporeon'), charizard);
    expect(vaporeon.off).toBeGreaterThan(0);
    expect(vaporeon.def).toBeGreaterThanOrEqual(0); // Fire is resisted, Flying is neutral
    const charVsVap = matchup(gen, fighter('Charizard'), foe('Vaporeon', ['Water']));
    expect(vaporeon.score).toBeGreaterThan(charVsVap.score);
  });
  it('treats immunities as decisive', () => {
    const garchomp = foe('Garchomp', ['Ground', 'Dragon']);
    const m = matchup(gen, fighter('Corviknight'), garchomp); // Flying is immune to Ground
    expect(m.def).toBeGreaterThanOrEqual(0);
    const bad = matchup(gen, fighter('Pikachu'), garchomp); // Electric cannot touch Ground
    expect(bad.off).toBe(-2);
  });
  it('builds a team that answers every foe', () => {
    const foes = [foe('Charizard', ['Fire', 'Flying']), foe('Garchomp', ['Ground', 'Dragon']), foe('Gengar', ['Ghost', 'Poison']),
      foe('Gyarados', ['Water', 'Flying']), foe('Kingambit', ['Dark', 'Steel']), foe('Dragonite', ['Dragon', 'Flying'])];
    const { objective, rank } = counterObjective(gen, foes);
    const res = optimizeTeam({ gen, rules: [newRule('species_clause'), newRule('no_legendaries')], locked: Array(6).fill(null), megas: false, objective, rank });
    expect(res.length).toBeGreaterThan(0);
    const matrix = matchupMatrix(gen, res[0].slots.map((s, i) => fighterFromMember(gen, { species: s, ability: res[0].abilities[i], moves: [] })), foes);
    const answers = bestAnswers(matrix, foes.length);
    expect(answers.every((a) => a.score > 0)).toBe(true);
    // beats the generic team against this enemy
    const generic = optimizeTeam({ gen, rules: [newRule('species_clause'), newRule('no_legendaries')], locked: Array(6).fill(null), megas: false })[0];
    const gm = matchupMatrix(gen, generic.slots.map((s) => fighterFromMember(gen, { species: s, moves: [] })), foes);
    const sum = (a: ReturnType<typeof bestAnswers>) => a.reduce((x, y) => x + y.score, 0);
    expect(sum(answers)).toBeGreaterThanOrEqual(sum(bestAnswers(gm, foes.length)));
  });
  it('lists individual counters and respects rules', () => {
    const water = newRule('allowed_types');
    water.params.types = ['Water'];
    const list = topCounters(gen, [water], foe('Charizard', ['Fire', 'Flying']), false, 5);
    expect(list).toHaveLength(5);
    expect(list.every((c) => c.species.types.includes('Water'))).toBe(true);
    expect(list[0].matchup.score).toBeGreaterThanOrEqual(list[4].matchup.score);
  });
  it('aims move choice at the foes', async () => {
    const plain = await autoMoves(gen, gen.species.get('Garchomp')!);
    const vsFlyers = await autoMoves(gen, gen.species.get('Garchomp')!, [['Flying'], ['Flying', 'Dragon'], ['Flying', 'Water']]);
    const hitsFlyers = vsFlyers.some((m) => ['Ice', 'Rock', 'Electric'].includes(gen.moves.get(m)!.type));
    expect(hitsFlyers).toBe(true);
    expect(plain).toHaveLength(4);
  });
});
