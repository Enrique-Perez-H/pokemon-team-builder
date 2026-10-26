import type { Move } from './data';
import type { Member } from './types';

/** Jobs a move can do for a team besides dealing damage. */
export type RoleId =
  | 'hazards' | 'removal' | 'recovery' | 'pivot' | 'setup' | 'speed' | 'screens' | 'status' | 'phazing' | 'priority';

export interface RoleInfo {
  id: RoleId;
  label: string;
  description: string;
  /** How many members doing this job is useful, and how much each one is worth to the optimizer. */
  cap: number;
  weight: number;
}

export const ROLES: RoleInfo[] = [
  { id: 'hazards', label: 'Hazards', description: 'Stealth Rock, Spikes, Toxic Spikes or Sticky Web', cap: 1, weight: 1.0 },
  { id: 'removal', label: 'Hazard removal', description: 'Rapid Spin, Defog, Court Change, Mortal Spin or Tidy Up', cap: 1, weight: 0.8 },
  { id: 'recovery', label: 'Recovery', description: 'Recover, Roost, Wish, Synthesis, Rest…', cap: 2, weight: 0.5 },
  { id: 'pivot', label: 'Pivot', description: 'U-turn, Volt Switch, Flip Turn, Parting Shot…', cap: 2, weight: 0.6 },
  { id: 'speed', label: 'Speed control', description: 'Tailwind, Trick Room, paralysis or speed-dropping moves', cap: 2, weight: 0.6 },
  { id: 'setup', label: 'Setup', description: 'Swords Dance, Nasty Plot, Dragon Dance, Calm Mind…', cap: 2, weight: 0.5 },
  { id: 'screens', label: 'Screens', description: 'Reflect, Light Screen or Aurora Veil', cap: 1, weight: 0.2 },
  { id: 'status', label: 'Status / disruption', description: 'Will-O-Wisp, Toxic, Spore, Taunt, Encore…', cap: 2, weight: 0.3 },
  { id: 'phazing', label: 'Phazing', description: 'Roar, Whirlwind, Dragon Tail, Circle Throw', cap: 1, weight: 0.2 },
  { id: 'priority', label: 'Priority', description: 'Attacks that move first: Extreme Speed, Aqua Jet, Sucker Punch…', cap: 1, weight: 0.4 },
];

export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleInfo>;

const HAZARD_SIDES = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);
const REMOVAL = new Set(['rapidspin', 'defog', 'courtchange', 'mortalspin', 'tidyup']);
const SCREEN_SIDES = new Set(['reflect', 'lightscreen', 'auroraveil']);
const SETUP_EXTRA = new Set(['bellydrum', 'filletaway', 'clangoroussoul', 'noretreat', 'victorydance', 'tidyup', 'shiftgear', 'coil', 'geomancy', 'curse']);
const DISRUPT_VOLATILE = new Set(['taunt', 'encore', 'leechseed', 'yawn', 'torment', 'attract', 'disable', 'healblock', 'embargo']);

const sumBoosts = (b?: Partial<Record<string, number>>): number => Object.values(b ?? {}).reduce<number>((a, v) => a + (v ?? 0), 0);

/** Every role a move can fill, read from its data (side conditions, boosts, healing flags…). */
export function moveRoles(m: Move): RoleId[] {
  const out: RoleId[] = [];
  const status = m.category === 'Status';
  if (m.sideCondition && HAZARD_SIDES.has(m.sideCondition) && m.target === 'foeSide') out.push('hazards');
  if (REMOVAL.has(m.id)) out.push('removal');
  if (status && (m.flags as Record<string, unknown>).heal) out.push('recovery');
  if (m.selfSwitch && m.selfSwitch !== 'copyvolatile') out.push('pivot');
  if ((status && m.target === 'self' && sumBoosts(m.boosts) > 0) || SETUP_EXTRA.has(m.id)) out.push('setup');
  const slows = (b?: Partial<Record<string, number>>) => (b?.spe ?? 0) < 0;
  if (
    m.sideCondition === 'tailwind' || m.sideCondition === 'stickyweb' || m.pseudoWeather === 'trickroom' ||
    (status && (m.status === 'par' || (m.target !== 'self' && slows(m.boosts)))) ||
    (!status && !!m.secondary && slows(m.secondary.boosts) && (m.secondary.chance ?? 100) >= 100)
  ) out.push('speed');
  if (m.sideCondition && SCREEN_SIDES.has(m.sideCondition)) out.push('screens');
  if (status && ((m.status && m.status !== 'par') || (m.volatileStatus && DISRUPT_VOLATILE.has(m.volatileStatus)))) out.push('status');
  if (m.forceSwitch) out.push('phazing');
  if (!status && m.priority > 0 && m.id !== 'fakeout') out.push('priority');
  return out;
}

export interface RoleHolder {
  /** Index into the team that was analysed. */
  member: number;
  name: string;
  moves: string[];
}

/** For each role, which members hold a move that fills it (from their chosen moves). */
export function teamRoles(team: Member[]): Record<RoleId, RoleHolder[]> {
  const out = Object.fromEntries(ROLES.map((r) => [r.id, [] as RoleHolder[]])) as Record<RoleId, RoleHolder[]>;
  team.forEach((m, i) => {
    for (const r of ROLES) {
      const hits = m.moves.filter((mv) => moveRoles(mv).includes(r.id)).map((mv) => mv.name);
      if (hits.length) out[r.id].push({ member: i, name: m.species.name, moves: hits });
    }
  });
  return out;
}

/** Roles worth warning about when a team of this size has none of them. */
export const EXPECTED_ROLES: RoleId[] = ['recovery', 'speed', 'pivot', 'removal'];
