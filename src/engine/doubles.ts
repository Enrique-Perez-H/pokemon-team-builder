import { bestAnswers } from './counter';
import type { Matchup } from './counter';
import { teamRoles } from './roles';
import type { Member } from './types';

export interface BringPlan {
  /** Indexes into the team of the Pokémon to bring. */
  bring: number[];
  /** Indexes of the two Pokémon to start the battle with. */
  leads: [number, number];
  /** How well the four cover the enemy team (sum over enemies of the best answer, with a little credit for a backup). */
  coverage: number;
  /** Enemy Pokémon none of the chosen four handle well, as indexes into the enemy team. */
  uncovered: number[];
}

/** Bad answers hurt more than good ones help, as in the counter-team objective. */
const shape = (x: number) => (x >= 0 ? x : x * 1.5);

function coverage(matrix: Matchup[][], members: number[], foes: number): number {
  let total = 0;
  for (let e = 0; e < foes; e++) {
    const scores = members.map((m) => matrix[m][e].score).sort((a, b) => b - a);
    total += shape(scores[0] ?? 0) + 0.3 * Math.max(0, scores[1] ?? 0);
  }
  return total;
}

function* combinations(n: number, k: number, start = 0, chosen: number[] = []): Generator<number[]> {
  if (chosen.length === k) { yield chosen; return; }
  for (let i = start; i <= n - (k - chosen.length); i++) yield* combinations(n, k, i + 1, [...chosen, i]);
}

/**
 * Doubles is played with four of your six. Pick the four that answer the enemy team best (matrix rows are our
 * Pokémon, columns the enemy's), then the two that should lead: the pair with the best joint answers, with credit
 * for Fake Out, speed control or redirection, which are what a good opening turn is built from.
 */
export function planBring(matrix: Matchup[][], team: Member[], size = 4): BringPlan | null {
  const n = team.length;
  const foes = matrix[0]?.length ?? 0;
  if (n < 2 || !foes) return null;
  const k = Math.min(size, n);

  let bring: number[] = [];
  let best = -Infinity;
  for (const combo of combinations(n, k)) {
    const c = coverage(matrix, combo, foes);
    if (c > best) { best = c; bring = [...combo]; }
  }

  const roles = teamRoles(team);
  const opening = (i: number) =>
    (['fakeout', 'speed', 'redirection'] as const).reduce((a, r) => a + (roles[r].some((h) => h.member === i) ? 0.4 : 0), 0);
  let leads: [number, number] = [bring[0], bring[1] ?? bring[0]];
  let leadBest = -Infinity;
  for (const pair of combinations(bring.length, 2)) {
    const members = pair.map((p) => bring[p]);
    const score = coverage(matrix, members, foes) + Math.min(1, opening(members[0]) + opening(members[1]));
    if (score > leadBest) { leadBest = score; leads = [members[0], members[1]]; }
  }

  const answers = bestAnswers(bring.map((m) => matrix[m]), foes);
  return { bring, leads, coverage: best, uncovered: answers.filter((a) => a.score < 0.75).map((a) => a.foe) };
}
