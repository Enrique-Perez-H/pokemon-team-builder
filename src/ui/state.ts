import { useEffect, useState } from 'react';
import { getGen } from '../engine/data';
import type { Generation, TypeName } from '../engine/data';
import { buildTeamSets } from '../engine/teamsets';
import type { OptimizedTeam } from '../engine/optimize';
import { suggestBuild } from '../engine/sets';
import type { Slot } from '../engine/team';
import type { Build } from '../engine/sets';
import type { Move, Specie } from '../engine/data';
import type { Member } from '../engine/types';
import { newRule } from '../engine/rules';
import type { RuleInstance } from '../engine/rules';

export type { Slot };

export interface BuilderState {
  gen: number;
  megas: boolean;
  slots: (Slot | null)[];
  rules: RuleInstance[];
  /** Species names of the opposing team (up to 6). */
  enemy: string[];
  /** Optional team name shown in the header and used when saving. */
  name: string;
}

const KEY = 'pokemon-team-builder:v1';
export const TEAM_SIZE = 6;

const initial = (): BuilderState => ({
  gen: 9,
  megas: false,
  slots: Array(TEAM_SIZE).fill(null),
  rules: [newRule('species_clause')],
  enemy: [],
  name: '',
});

function load(): BuilderState {
  const shared = readShareHash();
  if (shared) return shared;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as BuilderState;
      if (s.slots?.length === TEAM_SIZE && Array.isArray(s.rules)) return { ...s, enemy: s.enemy ?? [], name: s.name ?? '' };
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
 * Turn an optimizer result into slots: kept Pokémon stay as they are, new ones get the suggested ability and a
 * moveset built for the whole team (attacks plus the support jobs the team still needs), aimed at `foes` when given.
 */
export async function slotsFromResult(
  gen: Generation,
  team: OptimizedTeam,
  kept: (Slot | null)[],
  foes?: TypeName[][],
): Promise<Slot[]> {
  const keep = team.slots.map((sp, i) => (kept[i] && kept[i]!.species === sp.name ? kept[i]!.moves : null));
  const sets = await buildTeamSets(gen, team.slots, { foes, keep });
  return team.slots.map((sp, i): Slot => {
    const old = kept[i];
    if (old && old.species === sp.name) return old;
    const moves = sets[i];
    const ability = team.abilities[i];
    const mv = moves.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; });
    return { species: sp.name, ability, moves, build: suggestBuild(gen, sp, mv, ability) };
  });
}

/** The build to use for a slot: its saved one, or a suggested default for its species and moves. */
export function buildFor(gen: Generation, slot: Slot, species: Specie, moves: Move[]): Build {
  const base = slot.build ?? suggestBuild(gen, species, moves);
  return { ...base, ability: slot.ability ?? base.ability };
}

// ---------- Sharing ----------

type Shareable = Pick<BuilderState, 'gen' | 'megas' | 'slots' | 'rules' | 'enemy' | 'name'>;

const toB64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (b64: string) => {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const encodeShare = (st: Shareable): string =>
  toB64(JSON.stringify({ gen: st.gen, megas: st.megas, slots: st.slots, rules: st.rules, enemy: st.enemy, name: st.name }));

/** Validate and rebuild a state from a shared payload; null when it is not usable. */
export function decodeShare(payload: string): BuilderState | null {
  try {
    const raw = JSON.parse(fromB64(payload)) as Partial<BuilderState>;
    if (typeof raw.gen !== 'number' || raw.gen < 0 || raw.gen > 9) return null;
    if (!Array.isArray(raw.slots) || raw.slots.length !== TEAM_SIZE || !Array.isArray(raw.rules)) return null;
    const gen = getGen(raw.gen);
    const slots = raw.slots.map((s) => (s && typeof s.species === 'string' && gen.species.get(s.species) ? { ...s, moves: Array.isArray(s.moves) ? s.moves.slice(0, 4) : [] } : null));
    return { gen: raw.gen, megas: !!raw.megas, slots, rules: raw.rules.filter((r) => r && typeof r.type === 'string'), enemy: Array.isArray(raw.enemy) ? raw.enemy.filter((e) => typeof e === 'string' && gen.species.get(e)) : [], name: typeof raw.name === 'string' ? raw.name : '' };
  } catch {
    return null;
  }
}

export const shareUrl = (st: Shareable) => `${location.origin}${location.pathname}#t=${encodeShare(st)}`;

function readShareHash(): BuilderState | null {
  if (typeof location === 'undefined' || !location.hash.startsWith('#t=')) return null;
  const st = decodeShare(location.hash.slice(3));
  if (st) history.replaceState(null, '', location.pathname + location.search);
  return st;
}

// ---------- Saved teams ----------

export interface SavedTeam {
  id: string;
  name: string;
  savedAt: number;
  state: Shareable;
}

const TEAMS_KEY = 'pokemon-team-builder:teams';

function loadTeams(): SavedTeam[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TEAMS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function useSavedTeams() {
  const [teams, setTeams] = useState<SavedTeam[]>(loadTeams);
  const persist = (next: SavedTeam[]) => {
    setTeams(next);
    try {
      localStorage.setItem(TEAMS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  return {
    teams,
    save: (name: string, st: Shareable) => {
      const clean = name.trim() || 'Untitled team';
      const snapshot: SavedTeam = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()),
        name: clean, savedAt: Date.now(),
        state: { gen: st.gen, megas: st.megas, slots: st.slots, rules: st.rules, enemy: st.enemy, name: clean },
      };
      // Saving under an existing name overwrites it.
      persist([snapshot, ...teams.filter((t) => t.name !== clean)]);
    },
    remove: (id: string) => persist(teams.filter((t) => t.id !== id)),
  };
}

// ---------- Theme ----------

type Theme = 'dark' | 'light';
const THEME_KEY = 'pokemon-team-builder:theme';

/** Light/dark theme, defaulting to the system preference and remembered per browser. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* ignore */
    }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
