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
