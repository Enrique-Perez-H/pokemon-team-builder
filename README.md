# Pokémon Team Builder

Visual team builder (React + TypeScript + Vite). All Pokémon data comes from the offline
[`@pkmn/dex`](https://github.com/pkmn/ps) packages, so it is generation-accurate and needs no API.

```
npm install
npm run dev      # start the app
npm test         # engine tests
npm run build
```

## What it does now

- 6 team slots with a Pokémon picker (search, type filter, sort by any stat), plus ability and 4 moves chosen from
  the Pokémon's real learnset for the selected game generation (Gen 1–9).
- **Weaknesses & resistances** matrix for the whole team, including defensive abilities (Levitate, Flash Fire, Thick Fat…).
- **Type coverage**: which defending types your chosen moves hit super effectively (STAB is assumed until moves are picked).
- **Stats**: base stats per member, team averages, role labels, plus plain-language insights.
- **Rules**: composable rules (generation of origin, allowed/banned types, max per type, no legendaries,
  fully-evolved only, BST range…). Rules filter the picker and flag violations on the team.
- The picker shows **suggestions** that patch the team's weaknesses and coverage gaps.

## Layout

- `src/engine/` – pure TypeScript, no UI: `data` (dex access, learnsets), `types` (damage maths), `analysis`,
  `rules`, `suggest`. The future "best team for a game" and "counter this enemy team" features build on this.
- `src/ui/` – React components.

## Adding a rule

Add a `RuleDef` to `RULE_DEFS` in `src/engine/rules.ts` (`speciesCheck` for per-Pokémon limits, `teamCheck`
for whole-team limits). The rules panel, picker filtering and validation pick it up automatically.

## Roadmap

1. Team optimiser: search the legal pool under the active rules for the best-scoring team (coverage + defense + stats).
2. Enemy-team mode: enter an opposing team, get counters and a recommended lead/6.
3. Per-game availability (regional dexes, in-game moves), items, natures/EVs and real stat calculation.
