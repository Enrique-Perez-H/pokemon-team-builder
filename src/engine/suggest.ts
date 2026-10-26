import { coverageTable, defenseTable } from './analysis';
import { typeMultiplier, defensiveMultiplier } from './types';
import type { Member } from './types';
import { bst, speciesPool } from './data';
import type { Generation, Specie, TypeName } from './data';
import { wouldViolate } from './rules';
import type { RuleInstance } from './rules';

export interface Suggestion {
  species: Specie;
  score: number;
  reasons: string[];
}

/**
 * Rank rule-legal Pokémon for an empty slot by how well they patch the team's
 * shared weaknesses and offensive gaps. Uses types/STAB only so it is instant;
 * move-aware scoring belongs to the team optimiser.
 */
export function suggestPicks(
  gen: Generation,
  rules: RuleInstance[],
  slots: (Specie | null)[],
  team: Member[],
  slot: number,
  allowMegas: boolean,
  limit = 6,
): Suggestion[] {
  const def = defenseTable(gen, team);
  const gaps = new Set(coverageTable(gen, team).filter((r) => r.best <= 1).map((r) => r.type));
  const taken = new Set(slots.filter(Boolean).map((s) => s!.baseSpecies || s!.name));
  const out: Suggestion[] = [];

  for (const s of speciesPool(gen, allowMegas)) {
    if (taken.has(s.baseSpecies || s.name)) continue;
    if (wouldViolate(rules, slots, s, slot).length) continue;
    const fake: Member = { species: s, moves: [] };
    let score = bst(s) / 100;
    const fixes: TypeName[] = [];
    const risks: TypeName[] = [];
    for (const row of def) {
      const cover = row.resist + row.immune;
      const m = defensiveMultiplier(gen, fake, row.type);
      if (m < 1 && row.weak > cover) {
        score += (m === 0 ? 2.2 : 1.6) * Math.min(2, row.weak - cover);
        fixes.push(row.type);
      } else if (m > 1 && row.weak >= cover) {
        score -= 1.2 * m;
        risks.push(row.type);
      }
    }
    const hits: TypeName[] = [];
    for (const g of gaps) {
      if (s.types.some((t) => typeMultiplier(gen, t, [g]) > 1)) {
        score += 1.5;
        hits.push(g);
      }
    }
    const reasons: string[] = [];
    if (fixes.length) reasons.push(`Resists ${fixes.slice(0, 4).join(', ')}`);
    if (hits.length) reasons.push(`STAB hits ${hits.slice(0, 4).join(', ')}`);
    if (risks.length) reasons.push(`Adds weakness: ${risks.slice(0, 3).join(', ')}`);
    out.push({ species: s, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
