import { bst, gens, isLegendary } from './data';
import type { Specie, TypeName } from './data';

/**
 * Rules are plain serialisable instances ({ type, params }) interpreted by a RuleDef.
 * To add a new rule: add a RuleDef to RULE_DEFS. The UI, the picker filter and the
 * team validator all pick it up automatically.
 */
export interface RuleInstance {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export type ParamDef =
  | { key: string; label: string; kind: 'types' }
  | { key: string; label: string; kind: 'gens' }
  | { key: string; label: string; kind: 'number'; min: number; max: number }
  | { key: string; label: string; kind: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: 'species' };

export interface TeamViolation {
  /** Team indexes (positions in the array passed to teamCheck) at fault. */
  slots: number[];
  message: string;
}

export interface RuleDef {
  type: string;
  label: string;
  description: string;
  params: ParamDef[];
  defaults: Record<string, unknown>;
  /** Per-Pokémon check. Returns a reason when the species is not allowed. */
  speciesCheck?: (s: Specie, p: any) => string | null;
  /** Whole-team check. */
  teamCheck?: (team: Specie[], p: any) => TeamViolation[];
}

const list = (a: string[]) => a.join(', ');

const ULTRA_BEASTS = new Set([
  'Nihilego', 'Buzzwole', 'Pheromosa', 'Xurkitree', 'Celesteela', 'Kartana', 'Guzzlord', 'Poipole', 'Naganadel', 'Stakataka', 'Blacephalon',
]);

/** Smogon tiers from strongest to weakest. Anything else (LC, NFE, unreleased) counts as weakest. */
export const TIER_ORDER = ['AG', 'Uber', 'OU', 'UUBL', 'UU', 'RUBL', 'RU', 'NUBL', 'NU', 'PUBL', 'PU', 'ZUBL', 'ZU'];
const tierRank = (t: string | undefined) => {
  const i = t ? TIER_ORDER.indexOf(t) : -1;
  return i < 0 ? TIER_ORDER.length : i;
};

const tierCache = new Map<string, string | undefined>();

/**
 * A species' competitive tier. Pokémon missing from the current games are tiered "Illegal"; for those we use the
 * tier they had in the most recent generation that listed them, so tier limits still mean something in every-gen mode.
 */
function effectiveTier(s: Specie): string | undefined {
  if (TIER_ORDER.includes(s.tier)) return s.tier;
  if (tierCache.has(s.name)) return tierCache.get(s.name);
  let found: string | undefined;
  for (let g = 8; g >= 1 && !found; g--) {
    const t = gens.get(g).species.get(s.name)?.tier;
    if (t && TIER_ORDER.includes(t)) found = t;
  }
  tierCache.set(s.name, found);
  return found;
}

const STAT_OPTIONS = [
  { value: 'hp', label: 'HP' }, { value: 'atk', label: 'Attack' }, { value: 'def', label: 'Defense' },
  { value: 'spa', label: 'Sp. Atk' }, { value: 'spd', label: 'Sp. Def' }, { value: 'spe', label: 'Speed' },
];

export const RULE_DEFS: RuleDef[] = [
  {
    type: 'species_clause',
    label: 'Species clause',
    description: 'No two Pokémon of the same species.',
    params: [],
    defaults: {},
    teamCheck: (team) => {
      const seen = new Map<string, number>();
      const out: TeamViolation[] = [];
      team.forEach((s, i) => {
        const key = s.baseSpecies || s.name;
        if (seen.has(key)) out.push({ slots: [seen.get(key)!, i], message: `Duplicate species: ${key}` });
        else seen.set(key, i);
      });
      return out;
    },
  },
  {
    type: 'origin_gens',
    label: 'Only from generations',
    description: 'Pokémon must originate from one of the chosen generations.',
    params: [{ key: 'gens', label: 'Generations', kind: 'gens' }],
    defaults: { gens: [1] },
    speciesCheck: (s, p) => ((p.gens as number[]).includes(s.gen) ? null : `Generation ${s.gen} is not allowed`),
  },
  {
    type: 'allowed_types',
    label: 'Must have one of these types',
    description: 'Every Pokémon needs at least one of the chosen types. Pick a single type for a mono-type team.',
    params: [{ key: 'types', label: 'Types', kind: 'types' }],
    defaults: { types: ['Water'] },
    speciesCheck: (s, p) =>
      s.types.some((t) => (p.types as TypeName[]).includes(t)) ? null : `Needs one of: ${list(p.types)}`,
  },
  {
    type: 'banned_types',
    label: 'Banned types',
    description: 'No Pokémon with any of the chosen types.',
    params: [{ key: 'types', label: 'Types', kind: 'types' }],
    defaults: { types: ['Flying'] },
    speciesCheck: (s, p) => {
      const hit = s.types.find((t) => (p.types as TypeName[]).includes(t));
      return hit ? `${hit} type is banned` : null;
    },
  },
  {
    type: 'max_per_type',
    label: 'Max Pokémon per type',
    description: 'No more than N team members may share a type.',
    params: [{ key: 'max', label: 'Max', kind: 'number', min: 1, max: 6 }],
    defaults: { max: 2 },
    teamCheck: (team, p) => {
      const by = new Map<TypeName, number[]>();
      team.forEach((s, i) => s.types.forEach((t) => by.set(t, [...(by.get(t) ?? []), i])));
      return [...by].filter(([, v]) => v.length > p.max).map(([t, slots]) => ({
        slots,
        message: `More than ${p.max} ${t}-type Pokémon`,
      }));
    },
  },
  {
    type: 'no_legendaries',
    label: 'No legendaries',
    description: 'Bans legendary, mythical and sub-legendary Pokémon.',
    params: [],
    defaults: {},
    speciesCheck: (s) => (isLegendary(s) ? 'Legendary / mythical' : null),
  },
  {
    type: 'max_legendaries',
    label: 'Max legendaries',
    description: 'Allow only N legendary or mythical Pokémon on the team.',
    params: [{ key: 'max', label: 'Max', kind: 'number', min: 0, max: 6 }],
    defaults: { max: 1 },
    teamCheck: (team, p) => {
      const slots = team.flatMap((s, i) => (isLegendary(s) ? [i] : []));
      return slots.length > p.max ? [{ slots, message: `More than ${p.max} legendary Pokémon` }] : [];
    },
  },
  {
    type: 'fully_evolved',
    label: 'Fully evolved only',
    description: 'Pokémon that can still evolve are not allowed.',
    params: [],
    defaults: {},
    speciesCheck: (s) => (s.nfe ? 'Can still evolve' : null),
  },
  {
    type: 'bst_range',
    label: 'Base stat total range',
    description: 'Each Pokémon’s base stat total must be within the range.',
    params: [
      { key: 'min', label: 'Min BST', kind: 'number', min: 0, max: 800 },
      { key: 'max', label: 'Max BST', kind: 'number', min: 0, max: 800 },
    ],
    defaults: { min: 0, max: 600 },
    speciesCheck: (s, p) =>
      bst(s) < p.min ? `BST ${bst(s)} is below ${p.min}` : bst(s) > p.max ? `BST ${bst(s)} is above ${p.max}` : null,
  },
  {
    type: 'no_restricted',
    label: 'No restricted legendaries',
    description: 'Bans box legendaries (Mewtwo, Kyogre, Zacian…). Sub-legendaries and mythicals stay allowed.',
    params: [],
    defaults: {},
    speciesCheck: (s) => (s.tags.includes('Restricted Legendary') ? 'Restricted legendary' : null),
  },
  {
    type: 'no_mythicals',
    label: 'No mythicals',
    description: 'Bans mythical Pokémon (Mew, Jirachi, Deoxys…).',
    params: [],
    defaults: {},
    speciesCheck: (s) => (s.tags.includes('Mythical') ? 'Mythical' : null),
  },
  {
    type: 'no_paradox',
    label: 'No Paradox Pokémon',
    description: 'Bans the Ancient and Future Paradox Pokémon (Flutter Mane, Iron Valiant…).',
    params: [],
    defaults: {},
    speciesCheck: (s) => (s.tags.includes('Paradox') ? 'Paradox Pokémon' : null),
  },
  {
    type: 'no_ultra_beasts',
    label: 'No Ultra Beasts',
    description: 'Bans Nihilego, Kartana, Celesteela and the other Ultra Beasts.',
    params: [],
    defaults: {},
    speciesCheck: (s) => (ULTRA_BEASTS.has(s.baseSpecies || s.name) ? 'Ultra Beast' : null),
  },
  {
    type: 'tier_limit',
    label: 'Smogon tier limit',
    description: 'Nothing stronger than the chosen competitive tier (e.g. OU bans Ubers).',
    params: [{
      key: 'max', label: 'Strongest tier allowed', kind: 'select',
      options: TIER_ORDER.slice(1).map((t) => ({ value: t, label: t === 'Uber' ? 'Uber (only AG banned)' : t })),
    }],
    defaults: { max: 'OU' },
    speciesCheck: (s, p) => {
      const t = effectiveTier(s);
      return tierRank(t) < tierRank(p.max) ? `${t} is above ${p.max}` : null;
    },
  },
  {
    type: 'banned_pokemon',
    label: 'Banned Pokémon',
    description: 'Ban specific Pokémon by name (all of their forms).',
    params: [{ key: 'names', label: 'Pokémon', kind: 'species' }],
    defaults: { names: [] },
    speciesCheck: (s, p) => ((p.names as string[]).some((n) => n === s.name || n === s.baseSpecies) ? 'Banned' : null),
  },
  {
    type: 'little_cup',
    label: 'Little Cup',
    description: 'Only unevolved Pokémon that can still evolve.',
    params: [],
    defaults: {},
    speciesCheck: (s) => (s.evos?.length && !s.prevo ? null : 'Not a basic Pokémon that can evolve'),
  },
  {
    type: 'not_fully_evolved',
    label: 'Not fully evolved only',
    description: 'Pokémon that can still evolve (good for Eviolite).',
    params: [],
    defaults: {},
    speciesCheck: (s) => (s.nfe ? null : 'Already fully evolved'),
  },
  {
    type: 'stat_range',
    label: 'Base stat range',
    description: 'Limit one base stat, e.g. Speed at most 100 or HP at least 80.',
    params: [
      { key: 'stat', label: 'Stat', kind: 'select', options: STAT_OPTIONS },
      { key: 'min', label: 'Min', kind: 'number', min: 0, max: 255 },
      { key: 'max', label: 'Max', kind: 'number', min: 0, max: 255 },
    ],
    defaults: { stat: 'spe', min: 0, max: 100 },
    speciesCheck: (s, p) => {
      const v = s.baseStats[p.stat as 'hp'];
      return v < p.min ? `${p.stat.toUpperCase()} ${v} is below ${p.min}` : v > p.max ? `${p.stat.toUpperCase()} ${v} is above ${p.max}` : null;
    },
  },
];

export const ruleDef = (type: string) => RULE_DEFS.find((d) => d.type === type);

export function newRule(type: string): RuleInstance {
  const def = ruleDef(type)!;
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());
  return { id, type, enabled: true, params: structuredClone(def.defaults) };
}

const active = (rules: RuleInstance[]) =>
  rules.filter((r) => r.enabled).flatMap((r) => {
    const def = ruleDef(r.type);
    return def ? [{ rule: r, def }] : [];
  });

/** Reasons a species is individually not allowed. Empty = allowed. */
export function speciesViolations(rules: RuleInstance[], s: Specie): string[] {
  return active(rules).flatMap(({ rule, def }) => {
    const reason = def.speciesCheck?.(s, rule.params);
    return reason ? [reason] : [];
  });
}

export interface Violation {
  ruleId: string;
  /** Team indexes involved; empty for none. */
  slots: number[];
  message: string;
}

/** Validate a full team: per-Pokémon rules and team-wide rules. */
export function validateTeam(rules: RuleInstance[], team: (Specie | null)[]): Violation[] {
  const out: Violation[] = [];
  const idx = team.flatMap((s, i) => (s ? [i] : []));
  const present = idx.map((i) => team[i]!);
  for (const { rule, def } of active(rules)) {
    present.forEach((s, k) => {
      const reason = def.speciesCheck?.(s, rule.params);
      if (reason) out.push({ ruleId: rule.id, slots: [idx[k]], message: reason });
    });
    for (const v of def.teamCheck?.(present, rule.params) ?? []) {
      out.push({ ruleId: rule.id, slots: v.slots.map((k) => idx[k]), message: v.message });
    }
  }
  return out;
}

/** Reasons `candidate` cannot join `team` (replacing nothing). Empty = can join. */
export function wouldViolate(rules: RuleInstance[], team: (Specie | null)[], candidate: Specie, slot: number): string[] {
  // `slot` may be one past the end (appending a new member), so assign instead of mapping.
  const trial = [...team];
  trial[slot] = candidate;
  return validateTeam(rules, trial).filter((v) => v.slots.includes(slot)).map((v) => v.message);
}


// ---------- Quick options and presets ----------

export interface QuickRule {
  label: string;
  type: string;
  params?: Record<string, unknown>;
  hint: string;
}

/** One-click toggles shown above the rule list. */
export const QUICK_RULES: QuickRule[] = [
  { label: 'No legendaries', type: 'no_legendaries', hint: 'Bans legendary, sub-legendary and mythical Pokémon' },
  { label: 'No restricted legends', type: 'no_restricted', hint: 'Bans only the box legendaries (Mewtwo, Kyogre…)' },
  { label: 'No mythicals', type: 'no_mythicals', hint: 'Bans Mew, Jirachi, Deoxys…' },
  { label: 'No Paradox', type: 'no_paradox', hint: 'Bans Flutter Mane, Iron Valiant…' },
  { label: 'No Ultra Beasts', type: 'no_ultra_beasts', hint: 'Bans Nihilego, Kartana…' },
  { label: 'Fully evolved', type: 'fully_evolved', hint: 'Only Pokémon that cannot evolve further' },
  { label: 'All different types', type: 'max_per_type', params: { max: 1 }, hint: 'No two team members share a type' },
  { label: 'Max 2 per type', type: 'max_per_type', params: { max: 2 }, hint: 'At most two members of any type' },
];

const sameParams = (a: Record<string, unknown>, b?: Record<string, unknown>) =>
  !b || Object.keys(b).every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

export const hasQuick = (rules: RuleInstance[], q: QuickRule) =>
  rules.some((r) => r.type === q.type && r.enabled && sameParams(r.params, q.params));

/** Add the rule when absent; remove it when present. */
export function toggleQuick(rules: RuleInstance[], q: QuickRule): RuleInstance[] {
  if (rules.some((r) => r.type === q.type && sameParams(r.params, q.params))) {
    return rules.filter((r) => !(r.type === q.type && sameParams(r.params, q.params)));
  }
  const rule = newRule(q.type);
  Object.assign(rule.params, q.params);
  // A different "per type" limit replaces the existing one instead of stacking.
  return [...rules.filter((r) => !(q.type === 'max_per_type' && r.type === 'max_per_type')), rule];
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  build: () => RuleInstance[];
}

const make = (type: string, params: Record<string, unknown> = {}): RuleInstance => {
  const r = newRule(type);
  Object.assign(r.params, params);
  return r;
};

export const PRESETS: Preset[] = [
  { id: 'casual', label: 'Casual (anything goes)', description: 'Only the species clause.', build: () => [make('species_clause')] },
  {
    id: 'balanced', label: 'Balanced, no legends',
    description: 'No legendaries, mythicals or Paradox; at most 2 per type.',
    build: () => [make('species_clause'), make('no_legendaries'), make('no_paradox'), make('max_per_type', { max: 2 })],
  },
  {
    id: 'ou', label: 'Competitive (OU)',
    description: 'Fully evolved, nothing above OU.',
    build: () => [make('species_clause'), make('fully_evolved'), make('tier_limit', { max: 'OU' })],
  },
  {
    id: 'uu', label: 'Competitive (UU)',
    description: 'Fully evolved, nothing above UU.',
    build: () => [make('species_clause'), make('fully_evolved'), make('tier_limit', { max: 'UU' })],
  },
  {
    id: 'lc', label: 'Little Cup',
    description: 'Only unevolved Pokémon that can evolve.',
    build: () => [make('species_clause'), make('little_cup')],
  },
  {
    id: 'nuzlocke', label: 'In-game playthrough',
    description: 'No legendaries, mythicals or Paradox; no restricted tiers; a different type each.',
    build: () => [make('species_clause'), make('no_legendaries'), make('no_paradox'), make('no_ultra_beasts'), make('max_per_type', { max: 2 })],
  },
  {
    id: 'mono', label: 'Mono-type',
    description: 'Every Pokémon shares a type (change it in the rule).',
    build: () => [make('species_clause'), make('allowed_types', { types: ['Water'] }), make('no_legendaries')],
  },
  {
    id: 'kanto', label: 'Kanto only',
    description: 'Generation 1 Pokémon only.',
    build: () => [make('species_clause'), make('origin_gens', { gens: [1] })],
  },
];
