import { bst, isLegendary } from './data';
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
  | { key: string; label: string; kind: 'number'; min: number; max: number };

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
  const trial = team.map((s, i) => (i === slot ? candidate : s));
  return validateTeam(rules, trial).filter((v) => v.slots.includes(slot)).map((v) => v.message);
}
