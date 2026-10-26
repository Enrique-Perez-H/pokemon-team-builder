import { useEffect, useState } from 'react';
import { getGen } from '../engine/data';
import type { Generation } from '../engine/data';
import type { Member } from '../engine/types';
import { newRule } from '../engine/rules';
import type { RuleInstance } from '../engine/rules';

export interface Slot {
  species: string;
  ability?: string;
  moves: string[];
}

export interface BuilderState {
  gen: number;
  megas: boolean;
  slots: (Slot | null)[];
  rules: RuleInstance[];
}

const KEY = 'pokemon-team-builder:v1';
export const TEAM_SIZE = 6;

const initial = (): BuilderState => ({
  gen: 9,
  megas: false,
  slots: Array(TEAM_SIZE).fill(null),
  rules: [newRule('species_clause')],
});

function load(): BuilderState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as BuilderState;
      if (s.slots?.length === TEAM_SIZE && Array.isArray(s.rules)) return s;
    }
  } catch {
    /* fall through to defaults */
  }
  return initial();
}

export function useBuilder() {
  const [state, setState] = useState<BuilderState>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);
  return { state, setState, reset: () => setState(initial()) };
}

/** Turn saved slots into engine members; drops anything the generation does not know. */
export function resolveSlots(gen: Generation, slots: (Slot | null)[]): (Member | null)[] {
  return slots.map((s) => {
    if (!s) return null;
    const species = gen.species.get(s.species);
    if (!species) return null;
    const moves = s.moves.flatMap((m) => {
      const mv = gen.moves.get(m);
      return mv ? [mv] : [];
    });
    return { species, ability: s.ability, moves };
  });
}

export { getGen };
