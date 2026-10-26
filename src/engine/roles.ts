import type { Move } from './data';
import type { Member } from './types';

/** Jobs a move can do for a team besides dealing damage. */
export type RoleId =
  | 'hazards' | 'removal' | 'recovery' | 'pivot' | 'setup' | 'speed' | 'screens' | 'status' | 'phazing' | 'priority'
  | 'fakeout' | 'redirection' | 'ally' | 'protect' | 'spread';

/** Battle formats: singles is one-on-one, doubles (VGC style) has two Pokémon per side. */
export type Format = 'singles' | 'doubles';

export interface RoleInfo {
  id: RoleId;
  label: string;
  description: string;
  /** How many members doing this job is useful, and how much each one is worth to the optimizer (singles). */
  cap: number;
  weight: number;
  /** The same for doubles. A weight of 0 hides the role in that format. */
  doubles: { cap: number; weight: number };
}

export const ROLES: RoleInfo[] = [
  { id: 'hazards', label: 'Hazards', description: 'Stealth Rock, Spikes, Toxic Spikes or Sticky Web', cap: 1, weight: 1.0, doubles: { cap: 1, weight: 0.1 } },
  { id: 'removal', label: 'Hazard removal', description: 'Rapid Spin, Defog, Court Change, Mortal Spin or Tidy Up', cap: 1, weight: 0.8, doubles: { cap: 1, weight: 0.1 } },
  { id: 'recovery', label: 'Recovery', description: 'Recover, Roost, Wish, Synthesis, Rest…', cap: 2, weight: 0.5, doubles: { cap: 2, weight: 0.2 } },
  { id: 'pivot', label: 'Pivot', description: 'U-turn, Volt Switch, Flip Turn, Parting Shot…', cap: 2, weight: 0.6, doubles: { cap: 2, weight: 0.5 } },
  { id: 'speed', label: 'Speed control', description: 'Tailwind, Trick Room, paralysis or speed-dropping moves', cap: 2, weight: 0.6, doubles: { cap: 2, weight: 1.0 } },
  { id: 'setup', label: 'Setup', description: 'Swords Dance, Nasty Plot, Dragon Dance, Calm Mind…', cap: 2, weight: 0.5, doubles: { cap: 1, weight: 0.3 } },
  { id: 'screens', label: 'Screens', description: 'Reflect, Light Screen or Aurora Veil', cap: 1, weight: 0.2, doubles: { cap: 1, weight: 0.5 } },
  { id: 'status', label: 'Status / disruption', description: 'Will-O-Wisp, Toxic, Spore, Taunt, Encore…', cap: 2, weight: 0.3, doubles: { cap: 2, weight: 0.3 } },
  { id: 'phazing', label: 'Phazing', description: 'Roar, Whirlwind, Dragon Tail, Circle Throw', cap: 1, weight: 0.2, doubles: { cap: 1, weight: 0.1 } },
  { id: 'priority', label: 'Priority', description: 'Attacks that move first: Extreme Speed, Aqua Jet, Sucker Punch…', cap: 1, weight: 0.4, doubles: { cap: 1, weight: 0.5 } },
  { id: 'fakeout', label: 'Fake Out', description: 'Fake Out or Upper Hand: a free turn for your partner', cap: 1, weight: 0, doubles: { cap: 2, weight: 1.0 } },
  { id: 'redirection', label: 'Redirection', description: 'Follow Me or Rage Powder: protects a setup or Trick Room partner', cap: 1, weight: 0, doubles: { cap: 1, weight: 0.8 } },
  { id: 'ally', label: 'Partner support', description: 'Helping Hand, Wide Guard, Quick Guard, Coaching, Life Dew, Heal Pulse', cap: 1, weight: 0, doubles: { cap: 2, weight: 0.4 } },
  { id: 'protect', label: 'Protect', description: 'Protect, Detect, Spiky Shield, King’s Shield…: scouting and stalling a turn', cap: 1, weight: 0, doubles: { cap: 4, weight: 0.25 } },
  { id: 'spread', label: 'Spread attacks', description: 'Attacks that hit both opponents: Rock Slide, Heat Wave, Dazzling Gleam…', cap: 1, weight: 0, doubles: { cap: 2, weight: 0.6 } },
];

/** A role's cap and weight in a format, or null when it does not apply there. */
export function roleInfo(role: RoleId, format: Format = 'singles'): { info: RoleInfo; cap: number; weight: number } | null {
  const info = ROLE_BY_ID[role];
  const eff = format === 'doubles' ? info.doubles : { cap: info.cap, weight: info.weight };
  return eff.weight > 0 ? { info, ...eff } : null;
}

/** The roles shown in a format: those that matter there (hazards and the like are not worth listing in doubles). */
export const rolesFor = (format: Format = 'singles'): RoleInfo[] => ROLES.filter((r) => (roleInfo(r.id, format)?.weight ?? 0) >= 0.15);

export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r])) as Record<RoleId, RoleInfo>;

const HAZARD_SIDES = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);
const REMOVAL = new Set(['rapidspin', 'defog', 'courtchange', 'mortalspin', 'tidyup']);
const SCREEN_SIDES = new Set(['reflect', 'lightscreen', 'auroraveil']);
const SETUP_EXTRA = new Set(['bellydrum', 'filletaway', 'clangoroussoul', 'noretreat', 'victorydance', 'tidyup', 'shiftgear', 'coil', 'geomancy', 'curse']);
const DISRUPT_VOLATILE = new Set(['taunt', 'encore', 'leechseed', 'yawn', 'torment', 'attract', 'disable', 'healblock', 'embargo']);

const ALLY_SUPPORT = new Set(['helpinghand', 'coaching', 'wideguard', 'quickguard', 'lifedew', 'healpulse']);

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
  if (!status && m.priority > 0 && m.id !== 'fakeout' && m.id !== 'upperhand') out.push('priority');
  if (m.id === 'fakeout' || m.id === 'upperhand') out.push('fakeout');
  if (m.volatileStatus === 'followme' || m.volatileStatus === 'ragepowder') out.push('redirection');
  if (ALLY_SUPPORT.has(m.id)) out.push('ally');
  if (m.stallingMove && m.id !== 'endure') out.push('protect');
  if (!status && m.target === 'allAdjacentFoes') out.push('spread');
  return out;
}

export interface RoleHolder {
  /** Index into the team that was analysed. */
  member: number;
  name: string;
  moves: string[];
}

/** For each role, which members hold a move that fills it (from their chosen moves). Roles of every format are listed. */
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
export const EXPECTED_ROLES_DOUBLES: RoleId[] = ['speed', 'protect'];
export const expectedRoles = (format: Format = 'singles'): RoleId[] => (format === 'doubles' ? EXPECTED_ROLES_DOUBLES : EXPECTED_ROLES);

/** The handful of jobs summarised on the team report. */
export const coreRoles = (format: Format = 'singles'): RoleId[] =>
  format === 'doubles'
    ? ['fakeout', 'redirection', 'speed', 'pivot', 'ally', 'protect']
    : ['hazards', 'removal', 'recovery', 'pivot', 'speed', 'setup'];
