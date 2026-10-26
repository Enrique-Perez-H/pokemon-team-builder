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
import { bestMove, calcDamage, NO_BOOSTS, NO_FIELD } from './calc';
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
