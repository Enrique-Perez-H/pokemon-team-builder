import { useEffect, useState } from 'react';
import { getGen } from '../engine/data';
import type { Generation, TypeName } from '../engine/data';
import { autoMoves } from '../engine/moves';
import type { OptimizedTeam } from '../engine/optimize';
import { suggestBuild } from '../engine/sets';
import type { Build } from '../engine/sets';
import type { Move, Specie } from '../engine/data';
import type { Member } from '../engine/types';
import { newRule } from '../engine/rules';
import type { RuleInstance } from '../engine/rules';

export interface Slot {
  species: string;
  ability?: string;
  moves: string[];
  /** Level, nature, EVs, IVs and item. Missing means "use the suggested competitive build". */
  build?: Build;
}

export interface BuilderState {
  gen: number;
  megas: boolean;
  slots: (Slot | null)[];
  rules: RuleInstance[];
  /** Species names of the opposing team (up to 6). */
  enemy: string[];
}

const KEY = 'pokemon-team-builder:v1';
export const TEAM_SIZE = 6;

const initial = (): BuilderState => ({
  gen: 9,
  megas: false,
  slots: Array(TEAM_SIZE).fill(null),
  rules: [newRule('species_clause')],
  enemy: [],
});

function load(): BuilderState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as BuilderState;
      if (s.slots?.length === TEAM_SIZE && Array.isArray(s.rules)) return { ...s, enemy: s.enemy ?? [] };
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
  return { state, setState, reset: () => setState((st) => ({ ...initial(), enemy: st.enemy })) };
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


/**
 * Turn an optimizer result into slots: kept Pokémon stay as they are, new ones get the suggested
 * ability and automatically chosen attacking moves (aimed at `foes` when given).
 */
export async function slotsFromResult(
  gen: Generation,
  team: OptimizedTeam,
  kept: (Slot | null)[],
  foes?: TypeName[][],
): Promise<Slot[]> {
  return Promise.all(
    team.slots.map(async (sp, i): Promise<Slot> => {
      const old = kept[i];
      if (old && old.species === sp.name) return old;
      const moves = await autoMoves(gen, sp, foes);
      const ability = team.abilities[i];
      const mv = moves.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; });
      return { species: sp.name, ability, moves, build: suggestBuild(gen, sp, mv, ability) };
    }),
  );
}

/** The build to use for a slot: its saved one, or a suggested default for its species and moves. */
export function buildFor(gen: Generation, slot: Slot, species: Specie, moves: Move[]): Build {
  const base = slot.build ?? suggestBuild(gen, species, moves);
  return { ...base, ability: slot.ability ?? base.ability };
}
