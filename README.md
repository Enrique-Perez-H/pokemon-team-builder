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
- **Rules**: one-click toggles (no legendaries, no restricted legends, no mythicals, no Paradox, no Ultra Beasts,
  fully evolved, all-different types…), presets (Competitive OU/UU, Little Cup, Mono-type, Kanto only, in-game
  playthrough…) and composable rules: generation of origin, allowed/banned types, max per type, Smogon tier limit,
  banned Pokémon, Little Cup, stat ranges, BST range and more. Rules filter the picker, the optimizer and the
  suggestions, and flag violations on the team.
- **Team tools**: Showdown import/export, share links (the whole team and rules in the URL), saved teams in the
  browser, a team name, slot locks (the optimizer keeps locked Pokémon), drag-and-drop or arrow reordering, and a
  light/dark theme.
- **Team report**: defense and offense type counts, speed, physical/special balance, uncovered weaknesses, and a
  Stats tab with real stats and speed order.
- **Team optimizer**: searches the Pokémon your rules allow for the best team (beam search + swap polishing,
  ~0.3 s), balancing defense, type coverage and stats with adjustable weights. It can keep Pokémon you already
  picked, suggests abilities (e.g. Levitate, Water Absorb) and auto-selects four attacking moves per Pokémon.
- **Every generation** option: all Pokémon and moves from every game, using the modern (Gen 9) type chart.
- **Counter an enemy team** tab: enter up to six opposing Pokémon (their likely attacks are estimated from their
  best learnable moves) to see their shared weaknesses and the types they threaten you with, how your current team
  matches up (1v1 matrix on types, speed and power), the best individual counters for each enemy Pokémon, and a
  **counter team** built by the optimizer that answers every enemy while staying well rounded. Your rules apply.
- **Real stats and builds**: level, nature, EVs (510 cap), IVs and held item per Pokémon, with live final stats.
  "Suggest a build" picks a sensible competitive spread. Generations 1–2 use their own fixed-stat rules.
- **Damage calculator** tab (powered by [`@smogon/calc`](https://github.com/smogon/damage-calc)): any two Pokémon
  (your team, the enemy team or anyone), with builds, stat boosts, status, weather, terrain, screens and crits. It
  shows each move's damage range, KO chance and all 16 rolls, in both directions, and has a swap button.
- The enemy tab's **damage check** shows the real best-move damage between your team and the enemy.
- **Real-damage search**: the counter-team search and an optional "test against top threats" mode score teams with the
  damage calculator (best move on each side, speed and knock-out thresholds). Candidates are shortlisted cheaply,
  calculated once against each foe, then the beam search looks the numbers up, so it still takes about a second.
  Individual counters and the matchup table use the same real numbers.
- **Team roles and real movesets**: moves are classified by what they do (hazards, hazard removal, recovery, pivot,
  setup, speed control, screens, status, phazing, priority). The set builder hands those jobs out across the whole team
  (one hazard setter, one remover, recovery for the bulky, a pivot, setup for the sweepers) and fills the rest with
  attacks, so no Pokémon carries more than two support moves. "Fill empty moves" / "Rebuild all moves" use it, the
  optimizer scores teams on which jobs they can cover, and a Roles tab shows who does what and what is missing.
- The picker shows **suggestions** that patch the team's weaknesses and coverage gaps.

## Deploy to GitHub Pages / install as an app

`.github/workflows/pages.yml` typechecks, tests, builds and publishes `dist/` on every push to `main`.
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. (Serving the
branch directly does not work: the app must be built first.) It is then live at
`https://<user>.github.io/pokemon-team-builder/`. Builds use relative asset paths, so any path works.

The site is a PWA (manifest, icons, service worker): open it in Chrome/Edge/Safari and use *Install app* /
*Add to Home Screen*. After the first visit it works offline (sprites load from the network and are cached as seen).

## Layout

- `src/engine/` – pure TypeScript, no UI: `data` (dex access, learnsets), `types` (damage maths), `analysis`,
  `rules`, `suggest`, `optimize`, `moves`, `counter`. The future "best team for a game" and "counter this enemy team" features build on this.
- `src/ui/` – React components.

## Adding a rule

Add a `RuleDef` to `RULE_DEFS` in `src/engine/rules.ts` (`speciesCheck` for per-Pokémon limits, `teamCheck`
for whole-team limits). The rules panel, picker filtering and validation pick it up automatically.

## Roadmap

1. Per-game availability (regional dexes, in-game moves) and game-specific rules.
2. Doubles, Tera types, held-item suggestions and set sharing.
