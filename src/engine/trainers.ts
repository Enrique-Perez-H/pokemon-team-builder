import { hasTera } from './data';
import type { Generation, StatKey, TypeName } from './data';
import { hasNatures, suggestBuild, zeroEvs } from './sets';
import type { Build } from './sets';
import type { Slot } from './team';

/** A gym leader, Elite Four member, Champion or Kahuna and the team they use in one game. */
export interface RawTrainerMon {
  species: string;
  /** Form suffix such as "-Alola", appended to the species when the dex knows that form. */
  form?: string;
  level?: number;
  gender?: string;
  ability?: string;
  item?: string;
  tera?: string;
  nature?: string;
  evs?: Partial<Record<StatKey, number>>;
  moves: string[];
}

export interface Trainer {
  name: string;
  role: 'Gym Leader' | 'Elite Four' | 'Champion' | 'Kahuna';
  location: string;
  /** "Battle 2" and so on for repeat fights, which have different teams. */
  battle?: string;
  team: RawTrainerMon[];
}

export const ROLE_ORDER: Trainer['role'][] = ['Gym Leader', 'Kahuna', 'Elite Four', 'Champion'];

const cache = new Map<string, Promise<Trainer[]>>();

/** Trainer teams for a game (fetched lazily; an empty list when the game has none). */
export function loadTrainers(gameId: string, baseUrl = '/'): Promise<Trainer[]> {
  let p = cache.get(gameId);
  if (!p) {
    p = fetch(`${baseUrl}data/trainers/${gameId}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Trainer[]>) : []))
      .catch(() => []);
    cache.set(gameId, p);
  }
  return p;
}

export const trainerLabel = (t: Trainer): string => `${t.name}${t.battle ? ` (${t.battle.toLowerCase()})` : ''}`;

/** A move by name; truncated names ("Headlon. Rush") match the one move they start with. */
function moveName(gen: Generation, name: string): string | undefined {
  const exact = gen.moves.get(name);
  if (exact) return exact.name;
  const prefix = name.replace(/\.\s.*$|\.$/, '').toLowerCase();
  if (prefix.length < 4) return undefined;
  const hits = [...gen.moves].filter((mv) => mv.name.toLowerCase().startsWith(prefix));
  return hits.length === 1 ? hits[0].name : undefined;
}

/**
 * A trainer's team as slots, with their real level, ability, item and moves. In-game trainers have no EVs, so the
 * build is neutral. Pokémon the generation does not know are reported instead of dropped silently.
 */
export function trainerSlots(gen: Generation, t: Trainer): { slots: Slot[]; skipped: string[] } {
  const slots: Slot[] = [];
  const skipped: string[] = [];
  for (const m of t.team) {
    const sp = (m.form && gen.species.get(m.species + m.form)) || gen.species.get(m.species);
    if (!sp) { skipped.push(m.species); continue; }
    const moves = m.moves.map((n) => moveName(gen, n)).filter((n): n is string => !!n).slice(0, 4);
    const objs = moves.map((n) => gen.moves.get(n)!);
    const ability = m.ability && gen.abilities.get(m.ability)?.exists ? m.ability : undefined;
    const base = suggestBuild(gen, sp, objs, ability);
    const tera = m.tera && gen.types.get(m.tera) ? (gen.types.get(m.tera)!.name as TypeName) : undefined;
    const build: Build = {
      ...base,
      level: m.level ?? 50,
      nature: hasNatures(gen) ? (m.nature && gen.natures.get(m.nature) ? m.nature : 'Hardy') : base.nature,
      evs: { ...zeroEvs(), ...m.evs },
      item: gen.num >= 2 ? m.item ?? undefined : undefined,
      ability: ability ?? base.ability,
      ...(tera && hasTera(gen) ? { tera } : {}),
    };
    slots.push({ species: sp.name, ability: build.ability, moves, build });
  }
  return { slots, skipped };
}
