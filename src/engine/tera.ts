import { isDamaging, typesIn } from './data';
import type { Generation, TypeName } from './data';
import { defenseTable } from './analysis';
import { defensiveMultiplier } from './types';
import type { Member } from './types';

/**
 * A Tera type for each team member. A type scores for the weaknesses it would patch for the whole team (shared
 * weaknesses count most), plus a bonus when the Pokémon already has an attack of that type, since Terastallizing
 * boosts same-type moves. Ties keep the Pokémon's own first type.
 */
export function suggestTeraTypes(gen: Generation, team: Member[]): TypeName[] {
  const base = defenseTable(gen, team);
  const types = typesIn(gen);
  return team.map((m, i) => {
    let best: TypeName = m.species.types[0];
    let bestScore = -Infinity;
    const attacks = new Set(m.moves.filter(isDamaging).map((mv) => mv.type));
    // Own types first, so equal scores keep the original typing.
    const candidates = [...new Set([...m.species.types, ...types])];
    for (const t of candidates) {
      const as: Member = { ...m, tera: t };
      let score = 0;
      for (const row of base) {
        const before = row.perMember[i];
        const after = defensiveMultiplier(gen, as, row.type, true);
        const cover = row.resist + row.immune;
        const deficitBefore = Math.max(0, row.weak - cover);
        const weak = row.weak - (before > 1 ? 1 : 0) + (after > 1 ? 1 : 0);
        const covered = cover - (before < 1 ? 1 : 0) + (after < 1 ? 1 : 0);
        const deficitAfter = Math.max(0, weak - covered);
        score += deficitBefore ** 2 - deficitAfter ** 2;
        // Surviving a hit this Pokémon takes badly today is worth something even if the team is covered.
        if (before > 1 && after <= 1) score += 0.4;
        if (before <= 1 && after > 1) score -= 0.4;
      }
      if (attacks.has(t)) score += m.species.types.includes(t) ? 0.8 : 1.6;
      if (score > bestScore + 1e-9) { bestScore = score; best = t; }
    }
    return best;
  });
}
