import { beforeAll, describe, expect, it } from 'vitest';
import { getGen, speciesPool, learnableMoves } from './data';
import { defenseTable, coverageTable } from './analysis';
import { newRule, validateTeam, wouldViolate } from './rules';
import { suggestPicks } from './suggest';
import type { Member } from './types';

const gen = getGen(9);

// The damage calculator loads on demand in the app; tests load it once up front.
beforeAll(async () => { await loadCalc(); });
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

import { ALL_GENS, genId, isLegendary } from './data';

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

import { computeStats, evTotal, itemList, normalizeEvs, suggestBuild, zeroEvs, perfectIvs } from './sets';
import type { Build } from './sets';
import { bestMove, calcDamage, loadCalc, NO_BOOSTS, NO_FIELD } from './calc';
import type { Combatant } from './calc';

describe('real stats', () => {
  const garchomp = gen.species.get('Garchomp')!;
  const build = (over: Partial<Build> = {}): Build => ({ level: 100, nature: 'Adamant', evs: { ...zeroEvs(), atk: 252, spe: 252, hp: 4 }, ivs: perfectIvs(), ...over });
  it('matches known competitive stats', () => {
    const s = computeStats(gen, garchomp, build());
    expect(s).toMatchObject({ hp: 358, atk: 394, spe: 303 });
    expect(computeStats(gen, garchomp, build({ level: 50 })).hp).toBe(184);
  });
  it('applies natures and gives Shedinja 1 HP', () => {
    expect(computeStats(gen, garchomp, build({ nature: 'Modest' })).atk).toBeLessThan(394);
    expect(computeStats(gen, gen.species.get('Shedinja') ?? getGen(ALL_GENS).species.get('Shedinja')!, build()).hp).toBe(1);
  });
  it('uses max stat experience in Gen 1', () => {
    const g1 = getGen(1);
    expect(computeStats(g1, g1.species.get('Alakazam')!, { ...build(), nature: 'Hardy' }).spa).toBe(368);
  });
  it('normalizes EVs to the 510 cap', () => {
    const e = normalizeEvs({ ...zeroEvs(), atk: 252, spe: 252, hp: 252 }, 'hp');
    expect(evTotal(e)).toBeLessThanOrEqual(510);
    expect(e.hp % 4).toBe(0);
    expect(normalizeEvs({ ...zeroEvs(), atk: 999, def: 3 }).atk).toBe(252);
  });
  it('suggests builds that suit the role', () => {
    const fast = suggestBuild(gen, garchomp);
    expect(['Jolly', 'Adamant']).toContain(fast.nature);
    expect(fast.evs.atk).toBe(252);
    expect(evTotal(fast.evs)).toBeLessThanOrEqual(510);
    const wall = suggestBuild(gen, gen.species.get('Clodsire')!);
    expect(wall.evs.hp).toBe(252);
    expect(wall.item).toBe('Leftovers');
    expect(suggestBuild(getGen(1), getGen(1).species.get('Alakazam')!).item).toBeUndefined();
    expect(itemList(gen)).toContain('Life Orb');
    expect(itemList(getGen(1))).toEqual([]);
  });
});

describe('damage calculator', () => {
  const side = (species: string, build: Build): Combatant => ({ species, build, boosts: NO_BOOSTS(), status: '' });
  const att = side('Garchomp', { ...suggestBuild(gen, gen.species.get('Garchomp')!), nature: 'Adamant', item: 'Life Orb', ability: 'Rough Skin' });
  const skarm = side('Skarmory', { ...suggestBuild(gen, gen.species.get('Skarmory') ?? getGen(ALL_GENS).species.get('Skarmory')!), nature: 'Impish', ability: 'Sturdy', item: 'Leftovers' });
  it('computes ranges and percentages', () => {
    const r = calcDamage(9, att, skarm, 'Stone Edge');
    expect(r.ok).toBe(true);
    expect(r.max).toBeGreaterThan(r.min);
    expect(r.maxPct).toBeCloseTo((r.max / r.defenderHp) * 100, 5);
    expect(r.desc).toContain('Garchomp Stone Edge vs.');
    expect(r.rolls).toHaveLength(16);
  });
  it('handles immunities, status moves and unknown moves without throwing', () => {
    expect(calcDamage(9, att, side('Corviknight', skarm.build), 'Earthquake').ko).toBe('No effect');
    expect(calcDamage(9, att, skarm, 'Swords Dance').status).toBe(true);
    const bad = calcDamage(9, att, skarm, 'Totally Fake Move');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  });
  it('responds to items, boosts and field', () => {
    const base = calcDamage(9, att, skarm, 'Stone Edge').max;
    const noItem = calcDamage(9, { ...att, build: { ...att.build, item: undefined } }, skarm, 'Stone Edge').max;
    expect(base).toBeGreaterThan(noItem);
    const boosted = calcDamage(9, { ...att, boosts: { ...NO_BOOSTS(), atk: 2 } }, skarm, 'Stone Edge').max;
    expect(boosted).toBeGreaterThan(base);
    const screens = calcDamage(9, att, skarm, 'Stone Edge', { ...NO_FIELD, reflect: true }).max;
    expect(screens).toBeLessThan(base);
    const crit = calcDamage(9, att, skarm, 'Stone Edge', { ...NO_FIELD, crit: true }).max;
    expect(crit).toBeGreaterThan(base);
  });
  it('picks the strongest move and works across every generation', () => {
    const best = bestMove(9, att, skarm, ['Earthquake', 'Stone Edge', 'Outrage']);
    expect(best?.move).toBeTruthy();
    expect(calcDamage(ALL_GENS, side('Pidgeot', suggestBuild(gen, getGen(ALL_GENS).species.get('Pidgeot')!)), skarm, 'Hurricane').ok).toBe(true);
    const g4 = getGen(4);
    expect(calcDamage(4, side('Salamence', suggestBuild(g4, g4.species.get('Salamence')!)), side('Skarmory', suggestBuild(g4, g4.species.get('Skarmory')!)), 'Outrage').ok).toBe(true);
    const g1 = getGen(1);
    expect(calcDamage(1, side('Alakazam', suggestBuild(g1, g1.species.get('Alakazam')!)), side('Chansey', suggestBuild(g1, g1.species.get('Chansey')!)), 'Psychic').ok).toBe(true);
  });
});

import { PRESETS, QUICK_RULES, hasQuick, speciesViolations, toggleQuick } from './rules';

describe('more rules', () => {
  const sp = (n: string) => getGen(ALL_GENS).species.get(n)!;
  const rule = (type: string, params: Record<string, unknown> = {}) => { const r = newRule(type); Object.assign(r.params, params); return r; };
  it('bans each legendary class independently', () => {
    expect(speciesViolations([rule('no_restricted')], sp('Mewtwo'))).toHaveLength(1);
    expect(speciesViolations([rule('no_restricted')], sp('Articuno'))).toHaveLength(0);
    expect(speciesViolations([rule('no_mythicals')], sp('Mew'))).toHaveLength(1);
    expect(speciesViolations([rule('no_mythicals')], sp('Mewtwo'))).toHaveLength(0);
    expect(speciesViolations([rule('no_legendaries')], sp('Articuno'))).toHaveLength(1);
    expect(speciesViolations([rule('no_paradox')], sp('Flutter Mane'))).toHaveLength(1);
    expect(speciesViolations([rule('no_paradox')], sp('Garchomp'))).toHaveLength(0);
    expect(speciesViolations([rule('no_ultra_beasts')], sp('Kartana'))).toHaveLength(1);
  });
  it('limits by tier, evolution stage, stats and name', () => {
    expect(speciesViolations([rule('tier_limit', { max: 'OU' })], sp('Zacian'))).toHaveLength(1);
    expect(speciesViolations([rule('tier_limit', { max: 'OU' })], sp('Dragonite'))).toHaveLength(0);
    expect(speciesViolations([rule('tier_limit', { max: 'OU' })], sp('Pidgeot'))).toHaveLength(0); // unlisted tiers pass
    expect(speciesViolations([rule('little_cup')], sp('Charmander'))).toHaveLength(0);
    expect(speciesViolations([rule('little_cup')], sp('Charizard'))).toHaveLength(1);
    expect(speciesViolations([rule('little_cup')], sp('Pichu'))).toHaveLength(0);
    expect(speciesViolations([rule('not_fully_evolved')], sp('Charmeleon'))).toHaveLength(0);
    expect(speciesViolations([rule('not_fully_evolved')], sp('Charizard'))).toHaveLength(1);
    expect(speciesViolations([rule('stat_range', { stat: 'spe', min: 0, max: 100 })], sp('Garchomp'))).toHaveLength(1); // 102
    expect(speciesViolations([rule('stat_range', { stat: 'spe', min: 0, max: 100 })], sp('Corviknight'))).toHaveLength(0);
    expect(speciesViolations([rule('banned_pokemon', { names: ['Charizard'] })], sp('Charizard'))).toHaveLength(1);
    expect(speciesViolations([rule('banned_pokemon', { names: ['Charizard'] })], sp('Charizard-Mega-X'))).toHaveLength(1);
  });
  it('toggles quick options and swaps per-type limits', () => {
    const no = QUICK_RULES.find((q) => q.type === 'no_legendaries')!;
    let rules = toggleQuick([], no);
    expect(hasQuick(rules, no)).toBe(true);
    expect(toggleQuick(rules, no)).toEqual([]);
    const one = QUICK_RULES.find((q) => q.params?.max === 1)!;
    const two = QUICK_RULES.find((q) => q.params?.max === 2)!;
    rules = toggleQuick(toggleQuick(rules, one), two);
    expect(rules.filter((r) => r.type === 'max_per_type')).toHaveLength(1);
    expect(hasQuick(rules, two)).toBe(true);
    expect(hasQuick(rules, one)).toBe(false);
  });
  it('presets build legal teams the optimizer can satisfy', () => {
    for (const p of PRESETS) {
      const rules = p.build();
      expect(rules.length).toBeGreaterThan(0);
      const res = optimizeTeam({ gen: getGen(ALL_GENS), rules, locked: Array(6).fill(null), megas: false });
      expect(res.length, p.id).toBeGreaterThan(0);
      expect(validateTeam(rules, res[0].slots), p.id).toEqual([]);
    }
  });
});

describe('optimizer enforces team-wide rules', () => {
  const all = getGen(ALL_GENS);
  const rule = (type: string, params: Record<string, unknown> = {}) => { const r = newRule(type); Object.assign(r.params, params); return r; };
  const run = (rules: ReturnType<typeof newRule>[], g = all) => optimizeTeam({ gen: g, rules, locked: Array(6).fill(null), megas: false });
  it('never returns duplicate species', () => {
    const rules = [rule('species_clause')];
    for (const r of run(rules)) expect(validateTeam(rules, r.slots)).toEqual([]);
  });
  it('respects max per type and max legendaries', () => {
    const rules = [rule('species_clause'), rule('max_per_type', { max: 1 })];
    const res = run(rules, gen);
    expect(res.length).toBeGreaterThan(0);
    for (const r of res) {
      expect(validateTeam(rules, r.slots)).toEqual([]);
      const all18 = r.slots.flatMap((s) => s.types);
      expect(new Set(all18).size).toBe(all18.length);
    }
    const leg = [rule('species_clause'), rule('max_legendaries', { max: 1 })];
    for (const r of run(leg)) expect(r.slots.filter(isLegendary).length).toBeLessThanOrEqual(1);
  });
  it('applies tier limits to past-generation Pokémon', () => {
    const rules = [rule('species_clause'), rule('tier_limit', { max: 'OU' })];
    const names = run(rules)[0].slots.map((s) => s.name);
    expect(names).not.toContain('Yveltal');
    expect(speciesViolations(rules, all.species.get('Yveltal')!)).toHaveLength(1);
    expect(speciesViolations(rules, all.species.get('Pidgeot')!)).toHaveLength(0);
  });
});

import { exportTeam, importTeam } from './showdown';
import type { Slot } from './team';
import type { Specie } from './data';

describe('showdown format', () => {
  const garchomp: Slot = {
    species: 'Garchomp', ability: 'Rough Skin', moves: ['Earthquake', 'Outrage', 'Swords Dance', 'Stone Edge'],
    build: { level: 100, nature: 'Jolly', item: 'Life Orb', evs: { ...zeroEvs(), atk: 252, spe: 252, hp: 4 }, ivs: perfectIvs() },
  };
  const build = (s: Slot) => s.build!;
  it('round-trips a team', () => {
    const text = exportTeam(gen, [garchomp, null, { species: 'Skarmory', moves: ['Brave Bird'], build: { ...garchomp.build!, nature: 'Impish', item: 'Leftovers', ivs: { ...perfectIvs(), spe: 0 }, level: 50 } }], build);
    expect(text).toContain('Garchomp @ Life Orb');
    expect(text).toContain('EVs: 4 HP / 252 Atk / 252 Spe');
    expect(text).toContain('Jolly Nature');
    expect(text).toContain('Level: 50');
    expect(text).toContain('IVs: 0 Spe');
    const back = importTeam(gen, text);
    expect(back.warnings).toEqual([]);
    expect(back.slots).toHaveLength(2);
    expect(back.slots[0]).toMatchObject({ species: 'Garchomp', ability: 'Rough Skin', moves: garchomp.moves });
    expect(back.slots[0].build).toMatchObject({ nature: 'Jolly', item: 'Life Orb', level: 100, evs: garchomp.build!.evs });
    expect(back.slots[1].build).toMatchObject({ level: 50, nature: 'Impish', item: 'Leftovers' });
    expect(back.slots[1].build!.ivs.spe).toBe(0);
  });
  it('reads pasted Showdown teams with nicknames and reports problems', () => {
    const paste = `Landy (Landorus-Therian) (M) @ Choice Scarf\nAbility: Intimidate\nEVs: 252 Atk / 4 SpD / 252 Spe\nJolly Nature\n- Earthquake\n- U-turn\n- Not A Move\n\nMissingno @ Leftovers\n- Tackle`;
    const r = importTeam(getGen(ALL_GENS), paste);
    expect(r.slots).toHaveLength(1);
    expect(r.slots[0].species).toBe('Landorus-Therian');
    expect(r.slots[0].moves).toEqual(['Earthquake', 'U-turn']);
    expect(r.slots[0].build?.item).toBe('Choice Scarf');
    expect(r.warnings.join(' ')).toMatch(/Not A Move/);
    expect(r.warnings.join(' ')).toMatch(/Missingno/);
  });
  it('limits to six Pokémon and omits gen-specific fields for old gens', () => {
    const six = Array.from({ length: 8 }, () => 'Pikachu\n- Thunderbolt').join('\n\n');
    expect(importTeam(gen, six).slots).toHaveLength(6);
    const g1 = getGen(1);
    const out = exportTeam(g1, [{ species: 'Alakazam', moves: ['Psychic'], build: suggestBuild(g1, g1.species.get('Alakazam')!) }], build);
    expect(out).not.toMatch(/Nature|EVs|Ability|@/);
  });
});

import { teamReport } from './analysis';

describe('team report', () => {
  const mk = (names: string[]) => names.map((n) => ({ species: gen.species.get(n)!, moves: [] as never[] }));
  it('summarises coverage and only lists uncovered shared weaknesses', () => {
    const rock = teamReport(gen, mk(['Charizard', 'Talonflame', 'Corviknight']));
    expect(rock.typeCount).toBe(18);
    const weakRock = rock.sharedWeak.find((w) => w.type === 'Rock');
    expect(weakRock).toBeTruthy(); // Charizard and Talonflame are weak, Corviknight resists nothing
    expect(rock.sharedWeak.every((w) => w.weak > w.cover && w.weak >= 2)).toBe(true);
    const r = teamReport(gen, mk(['Garchomp', 'Gengar']));
    expect(r.physical + r.special + r.mixed).toBe(2);
    expect(r.fast).toBe(2);
  });
});

import { buildMatchupTable, prepareFoes, realMatchup, topCountersReal } from './realdamage';
import { optimizeVsFoes, pickThreats } from './search';

describe('real-damage search', () => {
  const sp = (n: string) => gen.species.get(n)!;
  it('scores matchups from real damage, in the right direction', async () => {
    const [charizard] = await prepareFoes(gen, [sp('Charizard')]);
    const [vaporeon] = await prepareFoes(gen, [sp('Vaporeon')]);
    const t1 = await buildMatchupTable(gen, [sp('Vaporeon')], [charizard]);
    const t2 = await buildMatchupTable(gen, [sp('Charizard')], [vaporeon]);
    const water = t1.get('Vaporeon')![0];
    const fire = t2.get('Charizard')![0];
    expect(water.score).toBeGreaterThan(0);
    expect(water.score).toBeGreaterThan(fire.score);
    expect(water.ourPct).toBeGreaterThan(water.theirPct);
    expect(water.ourMove).toBeTruthy();
    expect(realMatchup(9, { combatant: charizard.combatant, moves: charizard.moves, speed: charizard.speed }, vaporeon).theirPct).toBeGreaterThan(0);
  });
  it('builds a counter team that beats a type-only team on real damage', async () => {
    const foes = ['Charizard', 'Garchomp', 'Gengar', 'Gyarados', 'Kingambit', 'Dragonite'].map(sp);
    const rules = [newRule('species_clause'), newRule('no_legendaries'), newRule('no_paradox')];
    const locked = Array(6).fill(null);
    const t0 = Date.now();
    const real = await optimizeVsFoes({ gen, rules, locked, megas: false, foes, real: true, shortlist: 70 });
    const ms = Date.now() - t0;
    const typeOnly = await optimizeVsFoes({ gen, rules, locked, megas: false, foes, real: false });
    expect(ms).toBeLessThan(25000);
    expect(real.teams.length).toBeGreaterThan(0);
    expect(validateTeam(rules, real.teams[0].slots)).toEqual([]);
    // Judge both teams on the same real-damage numbers.
    const foeSets = real.foeSets;
    const judge = async (team: Specie[]) => {
      const table = await buildMatchupTable(gen, team, foeSets);
      return foeSets.reduce((sum, _f, e) => sum + Math.max(...team.map((s) => table.get(s.name)![e].score)), 0);
    };
    const realScore = await judge(real.teams[0].slots);
    const typeScore = await judge(typeOnly.teams[0].slots);
    expect(realScore).toBeGreaterThanOrEqual(typeScore - 0.01);
    for (let e = 0; e < foes.length; e++) {
      const best = Math.max(...real.teams[0].slots.map((s) => real.table.get(s.name)![e].score));
      expect(best).toBeGreaterThan(0);
    }
  }, 60000);
  it('re-ranks individual counters by real damage and respects rules', async () => {
    const [foe] = await prepareFoes(gen, [sp('Charizard')]);
    const water = newRule('allowed_types');
    water.params.types = ['Water'];
    const list = await topCountersReal(gen, [water], foe, false, 5);
    expect(list).toHaveLength(5);
    expect(list.every((c) => c.species.types.includes('Water'))).toBe(true);
    expect(list[0].matchup.score).toBeGreaterThanOrEqual(list[4].matchup.score);
  });
  it('picks a varied, rule-legal threat benchmark', () => {
    const rules = [newRule('species_clause'), newRule('no_legendaries'), newRule('no_paradox')];
    const threats = pickThreats(gen, rules, false, 10);
    expect(threats).toHaveLength(10);
    expect(threats.every((s) => !isLegendary(s) && !s.tags.includes('Paradox'))).toBe(true);
    const mains = threats.map((s) => s.types[0]);
    for (const t of new Set(mains)) expect(mains.filter((m) => m === t).length).toBeLessThanOrEqual(2);
  });
});

import { ROLES, moveRoles, teamRoles } from './roles';
import { buildTeamSets } from './teamsets';


describe('roles', () => {
  const mv = (n: string) => gen.moves.get(n)!;
  it('classifies moves from their data', () => {
    const roles = (n: string) => moveRoles(mv(n));
    expect(roles('Stealth Rock')).toContain('hazards');
    expect(roles('Rapid Spin')).toContain('removal');
    expect(roles('Roost')).toContain('recovery');
    expect(roles('Giga Drain')).not.toContain('recovery'); // attacking drain moves are not recovery
    expect(roles('U-turn')).toContain('pivot');
    expect(roles('Baton Pass')).not.toContain('pivot');
    expect(roles('Swords Dance')).toContain('setup');
    expect(roles('Trick Room')).toContain('speed');
    expect(roles('Thunder Wave')).toEqual(expect.arrayContaining(['speed']));
    expect(roles('Icy Wind')).toContain('speed');
    expect(roles('Will-O-Wisp')).toContain('status');
    expect(roles('Reflect')).toContain('screens');
    expect(roles('Dragon Tail')).toContain('phazing');
    expect(roles('Extreme Speed')).toContain('priority');
    expect(roles('Fake Out')).not.toContain('priority');
    expect(roles('Earthquake')).toEqual([]);
    expect(ROLES.every((r) => r.cap > 0 && (r.weight > 0 || r.doubles.weight > 0))).toBe(true);
  });
  it('maps team roles to the members holding them', () => {
    const team: Member[] = [
      { species: gen.species.get('Corviknight')!, moves: [mv('Roost'), mv('U-turn')] },
      { species: gen.species.get('Garchomp')!, moves: [mv('Earthquake'), mv('Stealth Rock')] },
    ];
    const r = teamRoles(team);
    expect(r.recovery.map((h) => h.name)).toEqual(['Corviknight']);
    expect(r.hazards.map((h) => h.name)).toEqual(['Garchomp']);
    expect(r.pivot[0].moves).toEqual(['U-turn']);
    expect(r.setup).toEqual([]);
  });
});

describe('team sets', () => {
  const names = ['Garchomp', 'Corviknight', 'Gengar', 'Clodsire', 'Primarina', 'Dragapult'];
  const team = names.map((n) => gen.species.get(n)!);
  it('covers support jobs without overloading anyone', async () => {
    const sets = await buildTeamSets(gen, team);
    expect(sets).toHaveLength(6);
    const members: Member[] = sets.map((moves, i) => ({ species: team[i], moves: moves.map((m) => gen.moves.get(m)!) }));
    for (const m of members) {
      expect(m.moves.length).toBeGreaterThan(0);
      expect(m.moves.length).toBeLessThanOrEqual(4);
      expect(new Set(m.moves.map((x) => x.id)).size).toBe(m.moves.length);
      const util = m.moves.filter((x) => x.category === 'Status').length;
      expect(util).toBeLessThanOrEqual(2);
      expect(m.moves.filter((x) => x.category !== 'Status').length).toBeGreaterThanOrEqual(2);
    }
    const roles = teamRoles(members);
    expect(roles.hazards.length).toBe(1);
    expect(roles.recovery.length).toBeGreaterThanOrEqual(1);
    expect(roles.pivot.length + roles.speed.length).toBeGreaterThanOrEqual(1);
    // every move is genuinely learnable by its owner
    for (let i = 0; i < team.length; i++) {
      const learnable = new Set((await learnableMoves(gen, team[i].name)).map((m) => m.id));
      for (const m of members[i].moves) expect(learnable.has(m.id)).toBe(true);
    }
  });
  it('keeps existing sets and counts their roles', async () => {
    const keep = [['Stealth Rock', 'Earthquake'], null, null, null, null, null];
    const sets = await buildTeamSets(gen, team, { keep });
    expect(sets[0]).toEqual(['Stealth Rock', 'Earthquake']);
    const members: Member[] = sets.map((moves, i) => ({ species: team[i], moves: moves.map((m) => gen.moves.get(m)!) }));
    expect(teamRoles(members).hazards.map((h) => h.name)).toEqual(['Garchomp']); // nobody doubles up on hazards
  });
  it('still fills four attacks for Pokémon that cannot do support jobs', async () => {
    const sets = await buildTeamSets(gen, [gen.species.get('Hawlucha')!]);
    expect(sets[0].length).toBeGreaterThanOrEqual(3);
  });
});

import { optimizeBalanced } from './search';
import { roleBonus, roleCapabilities } from './teamsets';
import { DEFAULT_WEIGHTS } from './optimize';

describe('role-aware optimizer', () => {
  const none = Array(6).fill(null);
  it('covers more support jobs when roles matter, without breaking rules', async () => {
    // A narrow pool (Fighting types only) is where raw strength and support jobs compete.
    const fighting = newRule('allowed_types');
    fighting.params.types = ['Fighting'];
    const rules = [newRule('species_clause'), newRule('no_legendaries'), newRule('no_paradox'), fighting];
    const withRoles = await optimizeBalanced({ gen, rules, locked: none, megas: false, weights: { ...DEFAULT_WEIGHTS, roles: 2 } });
    const without = await optimizeBalanced({ gen, rules, locked: none, megas: false, weights: { ...DEFAULT_WEIGHTS, roles: 0 } });
    expect(withRoles.length).toBeGreaterThan(0);
    expect(validateTeam(rules, withRoles[0].slots)).toEqual([]);
    const bonus = async (team: Specie[]) => { const caps = await roleCapabilities(gen, team); return roleBonus(team.map((s) => caps.get(s.name)!)); };
    expect(await bonus(withRoles[0].slots)).toBeGreaterThan(await bonus(without[0].slots));
    expect(withRoles[0].parts.roles).toBeGreaterThan(0);
    expect(without[0].parts.roles).toBe(0);
  });
  it('gives a hazard setter and recovery by default', async () => {
    const rules = [newRule('species_clause'), newRule('no_legendaries'), newRule('no_paradox')];
    const res = await optimizeBalanced({ gen, rules, locked: none, megas: false });
    const caps = await roleCapabilities(gen, res[0].slots);
    const all = res[0].slots.flatMap((s) => caps.get(s.name)!);
    expect(all).toContain('hazards');
    expect(all).toContain('recovery');
  });
  it('caps a single Pokémon at two jobs when scoring', () => {
    // One Pokémon able to do everything still only counts for two roles.
    const jack = ['hazards', 'removal', 'recovery', 'pivot', 'speed', 'setup'] as const;
    expect(roleBonus([[...jack]])).toBeLessThan(roleBonus([[...jack], [...jack], [...jack]]));
    expect(roleBonus([[...jack]])).toBeLessThanOrEqual(1.0 + 0.8);
  });
});

import { readFileSync } from 'node:fs';
import { GAME_BY_ID, GAME_LIST, availableInGame, gameData, parseGameData, registerGameData } from './games';
import type { RawGameData } from './games';
import { gameIdOf, genKey } from './data';

describe('per-game availability', () => {
  const load = (id: string) => registerGameData(id, JSON.parse(readFileSync(`public/data/games/${id}.json`, 'utf8')) as RawGameData);
  for (const g of GAME_LIST) load(g.id);
  const inGame = (game: string, name: string) => {
    const s = getGen(ALL_GENS).species.get(name)!;
    return availableInGame(GAME_BY_ID[game], gameData(game)!, s);
  };

  it('has data for every game in the catalog', () => {
    for (const g of GAME_LIST) {
      const d = gameData(g.id)!;
      expect(d.dex.size, g.id).toBeGreaterThan(100);
    }
    expect(parseGameData({ dex: [1], moves: [], learn: null }).learn).toBeNull();
  });
  it('knows which Pokémon are in which game', () => {
    expect(inGame('red-blue', 'Pikachu')).toBe(true);
    expect(inGame('red-blue', 'Mewtwo')).toBe(true);
    expect(inGame('red-blue', 'Chikorita')).toBe(false);
    expect(inGame('gold-silver', 'Chikorita')).toBe(true);
    expect(inGame('emerald', 'Rayquaza')).toBe(true);
    expect(inGame('emerald', 'Garchomp')).toBe(false);
    expect(inGame('scarlet-violet', 'Garchomp')).toBe(true);
    expect(inGame('scarlet-violet', 'Charizard')).toBe(true);
    expect(inGame('sword-shield', 'Charizard')).toBe(true);
    expect(inGame('diamond-pearl', 'Greninja')).toBe(false);
    expect(gameData('lets-go')!.dex.size).toBeLessThan(160);
  });
  it('limits regional forms and Megas to games that have them', () => {
    expect(inGame('sword-shield', 'Zigzagoon-Galar')).toBe(true);
    expect(inGame('sword-shield', 'Vulpix-Alola')).toBe(false);
    expect(inGame('ultra-sun-ultra-moon', 'Vulpix-Alola')).toBe(true);
    expect(inGame('scarlet-violet', 'Tauros-Paldea-Combat')).toBe(true);
    expect(inGame('emerald', 'Zigzagoon-Galar')).toBe(false);
    expect(inGame('x-y', 'Charizard-Mega-X')).toBe(true);
    expect(inGame('scarlet-violet', 'Charizard-Mega-X')).toBe(false);
    expect(inGame('omega-ruby-alpha-sapphire', 'Kyogre-Primal')).toBe(true);
  });
  it('gives each game its own generation object and cache key', () => {
    const bdsp = getGen(8, 'brilliant-diamond-shining-pearl');
    const swsh = getGen(8, 'sword-shield');
    expect(bdsp).not.toBe(swsh);
    expect(bdsp).not.toBe(getGen(8));
    expect(gameIdOf(bdsp)).toBe('brilliant-diamond-shining-pearl');
    expect(gameIdOf(getGen(8))).toBeUndefined();
    expect(new Set([genKey(bdsp), genKey(swsh), genKey(getGen(8)), genKey(getGen(9)), genKey(getGen(ALL_GENS))]).size).toBe(5);
    // Past Pokémon exist in a game's Generation so older-gen games work (Pidgeot is not in plain Gen 8 data)
    expect(bdsp.species.get('Pidgeot')).toBeTruthy();
  });
  it('restricts moves to what a Pokémon learns in that game', async () => {
    const rb = getGen(1, 'red-blue');
    const moves = (await learnableMoves(rb, 'Pikachu')).map((m) => m.name);
    expect(moves).toContain('Thunderbolt');
    expect(moves).not.toContain('Volt Tackle');
    const plain = (await learnableMoves(getGen(1), 'Pikachu')).map((m) => m.name);
    expect(moves.length).toBeLessThanOrEqual(plain.length);
    const sv = getGen(9, 'scarlet-violet');
    const garchomp = (await learnableMoves(sv, 'Garchomp')).map((m) => m.name);
    expect(garchomp).toContain('Earthquake');
    const za = getGen(9, 'legends-za');
    expect((await learnableMoves(za, 'Garchomp')).length).toBeGreaterThan(20); // no Z-A move data: falls back to Gen 9
    // formes without their own entry fall back to the base species
    expect((await learnableMoves(sv, 'Tauros-Paldea-Combat')).length).toBeGreaterThan(10);
  });
  it('the game rule filters pickers and the optimizer', () => {
    const rule = newRule('game_dex');
    rule.params.game = 'red-blue';
    const g = getGen(1, 'red-blue');
    expect(speciesViolations([rule], g.species.get('Chikorita') ?? getGen(ALL_GENS).species.get('Chikorita')!)).toHaveLength(1);
    expect(speciesViolations([rule], g.species.get('Pikachu')!)).toHaveLength(0);
    const pool = speciesPool(g, false).filter((s) => speciesViolations([rule], s).length === 0);
    expect(pool.length).toBe(151);
    const res = optimizeTeam({ gen: g, rules: [newRule('species_clause'), rule], locked: Array(6).fill(null), megas: false });
    expect(res[0].slots.every((s) => s.num <= 151)).toBe(true);
    // a disabled rule allows everything again
    expect(speciesViolations([{ ...rule, enabled: false }], getGen(ALL_GENS).species.get('Chikorita')!)).toHaveLength(0);
  });
  it('does nothing until the game data has loaded', () => {
    const rule = newRule('game_dex');
    rule.params.game = 'not-a-game';
    expect(speciesViolations([rule], getGen(ALL_GENS).species.get('Chikorita')!)).toHaveLength(0);
  });
});

describe('role moves follow the generation', () => {
  it('does not treat old-generation Teleport as a pivot', async () => {
    const g1 = getGen(1);
    const starmie = g1.species.get('Starmie')!;
    const sets = await buildTeamSets(g1, [starmie]);
    expect(sets[0]).not.toContain('Teleport');
    const g9 = getGen(9);
    expect(moveRoles(g9.moves.get('Teleport')!)).toContain('pivot');
    expect(moveRoles(g1.moves.get('Teleport')!)).not.toContain('pivot');
  });
});

import { suggestTeraTypes } from './tera';
import { hasTera, typesIn } from './data';
import { defensiveMultiplier } from './types';

describe('tera', () => {
  const mem = (n: string, moves: string[] = []): Member => ({ species: gen.species.get(n)!, moves: moves.map((m) => gen.moves.get(m)!) });
  it('only exists where Terastallization does', () => {
    expect(hasTera(getGen(9))).toBe(true);
    expect(hasTera(getGen(9, 'scarlet-violet'))).toBe(true);
    expect(hasTera(getGen(9, 'legends-za'))).toBe(false);
    expect(hasTera(getGen(8))).toBe(false);
    expect(hasTera(getGen(ALL_GENS))).toBe(true);
  });
  it('applies Tera typing to defence only when asked', () => {
    const charizard = { ...mem('Charizard'), tera: 'Water' as const };
    const rock = (tera: boolean) => defenseTable(gen, [charizard], tera).find((r) => r.type === 'Rock')!.perMember[0];
    expect(rock(false)).toBe(4);
    expect(rock(true)).toBe(1);
    const electric = (tera: boolean) => defenseTable(gen, [charizard], tera).find((r) => r.type === 'Electric')!.perMember[0];
    expect(electric(true)).toBe(2);
    expect(defenseTable(gen, [mem('Charizard')], true).find((r) => r.type === 'Rock')!.perMember[0]).toBe(4); // no tera chosen
  });
  it('suggests valid, useful Tera types', () => {
    const team = [mem('Charizard', ['Flamethrower', 'Air Slash']), mem('Talonflame', ['Brave Bird']), mem('Corviknight', ['Brave Bird']), mem('Garchomp', ['Earthquake', 'Outrage'])];
    const teras = suggestTeraTypes(gen, team);
    expect(teras).toHaveLength(4);
    for (const t of teras) expect(typesIn(gen)).toContain(t);
    expect(suggestTeraTypes(gen, team)).toEqual(teras); // deterministic
    // Three Rock-weak flyers: at least one of them should patch it by changing type
    const rockPatchers = team.slice(0, 3).filter((m, i) => defensiveMultiplier(gen, { ...m, tera: teras[i] }, 'Rock', true) <= 1 && defensiveMultiplier(gen, m, 'Rock') > 1);
    expect(rockPatchers.length).toBeGreaterThanOrEqual(1);
    // a suggestion never leaves a Pokémon with more weaknesses than it started with
    const weakCount = (m: Member, tera: boolean) => defenseTable(gen, [m], tera).filter((r) => r.perMember[0] > 1).length;
    const garchomp = mem('Garchomp', ['Earthquake']);
    const [pick] = suggestTeraTypes(gen, [garchomp]);
    expect(weakCount({ ...garchomp, tera: pick }, true)).toBeLessThanOrEqual(weakCount(garchomp, false));
  });
  it('flows through the calculator and Showdown format', async () => {
    const att = { species: 'Garchomp', build: { ...suggestBuild(gen, gen.species.get('Garchomp')!), ability: 'Rough Skin' }, boosts: NO_BOOSTS(), status: '' as const };
    const def = { species: 'Corviknight', build: suggestBuild(gen, gen.species.get('Corviknight')!), boosts: NO_BOOSTS(), status: '' as const };
    expect(calcDamage(9, att, def, 'Earthquake').ko).toBe('No effect'); // Flying is immune to Ground
    expect(calcDamage(9, att, { ...def, tera: 'Water' }, 'Earthquake').max).toBeGreaterThan(0);
    const slot: Slot = { species: 'Garchomp', moves: ['Earthquake'], build: { ...att.build, tera: 'Fire' } };
    const text = exportTeam(gen, [slot], (s) => s.build!);
    expect(text).toContain('Tera Type: Fire');
    expect(importTeam(gen, text).slots[0].build?.tera).toBe('Fire');
    expect(exportTeam(getGen(8), [slot], (s) => s.build!)).not.toContain('Tera Type');
  });
});

import { planBring } from './doubles';
import { roleInfo, rolesFor, expectedRoles } from './roles';
import type { Matchup } from './counter';

describe('doubles', () => {
  const mv = (n: string) => gen.moves.get(n)!;
  it('recognises doubles-only roles', () => {
    expect(moveRoles(mv('Follow Me'))).toContain('redirection');
    expect(moveRoles(mv('Rage Powder'))).toContain('redirection');
    expect(moveRoles(mv('Fake Out'))).toEqual(['fakeout']);
    expect(moveRoles(mv('Helping Hand'))).toContain('ally');
    expect(moveRoles(mv('Wide Guard'))).toContain('ally');
    expect(moveRoles(mv('Protect'))).toContain('protect');
    expect(moveRoles(mv('Endure'))).not.toContain('protect');
    expect(moveRoles(mv('Rock Slide'))).toContain('spread');
    expect(moveRoles(mv('Earthquake'))).not.toContain('spread'); // also hits your partner
    expect(moveRoles(mv('Icy Wind'))).toEqual(expect.arrayContaining(['spread', 'speed']));
  });
  it('weights roles by format', () => {
    expect(roleInfo('hazards', 'singles')!.weight).toBeGreaterThan(roleInfo('hazards', 'doubles')!.weight);
    expect(roleInfo('speed', 'doubles')!.weight).toBeGreaterThan(roleInfo('speed', 'singles')!.weight);
    expect(roleInfo('fakeout', 'singles')).toBeNull();
    expect(rolesFor('singles').map((r) => r.id)).not.toContain('protect');
    expect(rolesFor('doubles').map((r) => r.id)).not.toContain('hazards');
    expect(rolesFor('doubles').map((r) => r.id)).toEqual(expect.arrayContaining(['fakeout', 'redirection', 'protect', 'spread']));
    expect(expectedRoles('doubles')).toContain('protect');
  });
  it('builds doubles sets: Protect, Fake Out, redirection, speed control, spread', async () => {
    const names = ['Incineroar', 'Amoonguss', 'Whimsicott', 'Rillaboom', 'Garchomp', 'Gholdengo'];
    const team = names.map((n) => gen.species.get(n)!);
    const sets = await buildTeamSets(gen, team, { format: 'doubles' });
    const members: Member[] = sets.map((moves, i) => ({ species: team[i], moves: moves.map((m) => gen.moves.get(m)!) }));
    const roles = teamRoles(members);
    expect(roles.protect.length).toBeGreaterThanOrEqual(4);
    expect(roles.fakeout.length).toBeGreaterThanOrEqual(1);
    expect(roles.redirection.length).toBe(1);
    expect(roles.speed.length).toBeGreaterThanOrEqual(1);
    for (const m of members) {
      expect(m.moves.length).toBeLessThanOrEqual(4);
      expect(new Set(m.moves.map((x) => x.id)).size).toBe(m.moves.length);
      expect(m.moves.filter((x) => x.category !== 'Status').length).toBeGreaterThanOrEqual(1);
    }
    // singles sets on the same team do not bother with Protect or redirection
    const singles = await buildTeamSets(gen, team, { format: 'singles' });
    const sRoles = teamRoles(singles.map((moves, i) => ({ species: team[i], moves: moves.map((m) => gen.moves.get(m)!) })));
    expect(sRoles.redirection.length).toBe(0);
    expect(sRoles.protect.length).toBeLessThan(roles.protect.length);
  });
  it('applies the spread-move reduction in doubles', () => {
    const garchomp = { species: 'Garchomp', build: suggestBuild(gen, gen.species.get('Garchomp')!), boosts: NO_BOOSTS(), status: '' as const };
    const target = { species: 'Charizard', build: suggestBuild(gen, gen.species.get('Charizard')!), boosts: NO_BOOSTS(), status: '' as const };
    const singles = calcDamage(9, garchomp, target, 'Rock Slide', NO_FIELD).max;
    const doubles = calcDamage(9, garchomp, target, 'Rock Slide', { ...NO_FIELD, gameType: 'Doubles' }).max;
    expect(doubles / singles).toBeCloseTo(0.75, 1);
    // single-target moves are unaffected
    expect(calcDamage(9, garchomp, target, 'Stone Edge', { ...NO_FIELD, gameType: 'Doubles' }).max).toBe(calcDamage(9, garchomp, target, 'Stone Edge', NO_FIELD).max);
  });
  it('plans which four to bring and who leads', () => {
    const cell = (score: number): Matchup => ({ score, off: 0, def: 0, speed: 0 });
    // members 0-3 each handle a different enemy well; 4 and 5 handle nothing
    const matrix = [
      [cell(2.5), cell(-1), cell(-1)],
      [cell(-1), cell(2.5), cell(-1)],
      [cell(-1), cell(-1), cell(2.5)],
      [cell(1), cell(1), cell(1)],
      [cell(-2), cell(-2), cell(-2)],
      [cell(-1.5), cell(-1.5), cell(-1.5)],
    ];
    const team: Member[] = Array.from({ length: 6 }, (_, i) => ({
      species: gen.species.get(['Incineroar', 'Garchomp', 'Gholdengo', 'Rillaboom', 'Magikarp', 'Caterpie'][i]) ?? gen.species.get('Garchomp')!,
      moves: i === 0 ? [mv('Fake Out'), mv('Protect')] : [],
    }));
    const plan = planBring(matrix, team)!;
    expect(plan.bring.sort()).toEqual([0, 1, 2, 3]);
    expect(plan.leads).toHaveLength(2);
    expect(plan.leads.every((l) => plan.bring.includes(l))).toBe(true);
    expect(plan.leads).toContain(0); // the Fake Out user opens
    expect(plan.uncovered).toEqual([]);
    expect(planBring([], [])).toBeNull();
  });
  it('optimizes for doubles', async () => {
    const rules = [newRule('species_clause'), newRule('no_legendaries'), newRule('no_paradox')];
    const res = await optimizeBalanced({ gen, rules, locked: Array(6).fill(null), megas: false, format: 'doubles' });
    expect(res.length).toBeGreaterThan(0);
    expect(validateTeam(rules, res[0].slots)).toEqual([]);
    expect(res[0].parts.roles).toBeGreaterThan(0);
    const caps = await roleCapabilities(gen, res[0].slots, 'doubles');
    const all = res[0].slots.flatMap((s) => caps.get(s.name)!);
    expect(all).toContain('protect');
    expect(all).toContain('speed');
    expect(roleBonus([['fakeout', 'protect'], ['redirection']], 'doubles')).toBeGreaterThan(roleBonus([[]], 'doubles'));
  });
});
