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
- **Team optimizer**: searches the Pokémon your rules allow for the best team (beam search + swap polishing,
  ~0.3 s), balancing defense, type coverage and stats with adjustable weights. It can keep Pokémon you already
  picked, suggests abilities (e.g. Levitate, Water Absorb) and auto-selects four attacking moves per Pokémon.
- The picker shows **suggestions** that patch the team's weaknesses and coverage gaps.

## Deploy to GitLab Pages / install as an app

`.gitlab-ci.yml` runs typecheck, tests and build on every pipeline and publishes `dist/` to GitLab Pages from the
default branch (`https://<namespace>.gitlab.io/<project>/`). Builds use relative asset paths, so any project path works.

The site is a PWA (manifest, icons, service worker): open it in Chrome/Edge/Safari and use *Install app* /
*Add to Home Screen*. After the first visit it works offline (sprites load from the network and are cached as seen).

```
git remote add gitlab git@gitlab.com:<namespace>/<project>.git
git push gitlab <branch>:main
```

## Layout

- `src/engine/` – pure TypeScript, no UI: `data` (dex access, learnsets), `types` (damage maths), `analysis`,
  `rules`, `suggest`, `optimize`, `moves`. The future "best team for a game" and "counter this enemy team" features build on this.
- `src/ui/` – React components.

## Adding a rule

Add a `RuleDef` to `RULE_DEFS` in `src/engine/rules.ts` (`speciesCheck` for per-Pokémon limits, `teamCheck`
for whole-team limits). The rules panel, picker filtering and validation pick it up automatically.

## Roadmap

1. Enemy-team mode: enter an opposing team, get counters and a recommended lead/6.
2. Per-game availability (regional dexes, in-game moves), items, natures/EVs and real stat calculation.
