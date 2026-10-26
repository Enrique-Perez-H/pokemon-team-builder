# Pokémon Team Builder

Visual team builder (React + TypeScript + Vite). All Pokémon data comes from the offline
[`@pkmn/dex`](https://github.com/pkmn/ps) packages, so it is generation-accurate and needs no API.

```
npm install
npm run dev      # start the app
npm test         # unit tests (engine)
npm run e2e      # build, then browser tests (desktop and phone) with Playwright
npm run build
```

Browser tests need a Chromium: `npm run e2e:install` once (CI does this itself).

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
- **Per-game availability**: pick a specific game (Red/Blue through Scarlet/Violet and Legends: Z-A, expansions merged
  into their base game) and the pool becomes that game's regional Pokédex, move lists become exactly what each Pokémon
  learns there, regional forms and Megas only appear where the game has them, and the game's generation drives the
  type chart and mechanics. A managed rule ("Only Pokémon in …") can be switched off for a National Dex style pool.
  PokeAPI has no Legends: Z-A movesets yet, so that game uses Gen 9 moves.
- **Tera types** (Gen 9): a Tera type per Pokémon (build editor, card badge, Showdown format), team-aware
  suggestions that patch shared weaknesses, a Terastallized view of the defence matrix and Tera in the calculator.
- **Doubles**: a Singles/Doubles switch. Doubles adds roles (Fake Out, redirection, partner support, Protect, spread
  attacks), builds sets with Protect and spread moves, scores teams on doubles roles, applies the spread-move damage
  reduction in the calculator and recommends which four to bring and who leads against an enemy team.
- **Phones**: a compact header, a bottom tab bar, bottom-sheet dialogs, large touch targets and 16px form text, with the
  optimizer right under your team.
- The picker shows **suggestions** that patch the team's weaknesses and coverage gaps.

## Deploy to GitHub Pages / install as an app

`.github/workflows/pages.yml` typechecks, runs the unit and browser tests, builds and publishes `dist/` on every push to
`main` (pull requests run the same checks without deploying).
One-time setup: repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. (Serving the
branch directly does not work: the app must be built first.) It is then live at
`https://<user>.github.io/pokemon-team-builder/`. Builds use relative asset paths, so any path works.

The site is a PWA (manifest, icons, service worker): open it in Chrome/Edge/Safari and use *Install app* /
*Add to Home Screen*. After the first visit it works offline (sprites load from the network and are cached as seen).

## Game data

`public/data/games/<game>.json` (one small file per game, fetched only when the game is selected and cached by the
service worker) is generated from [PokeAPI's CSV data](https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv):

```
node scripts/build-game-data.mjs <folder with the CSVs> public/data/games
```

The header of `scripts/build-game-data.mjs` lists the files to download. Re-run it when PokeAPI adds games or moves.

## Layout

- `src/engine/` – pure TypeScript, no UI: `data` (dex access, learnsets), `types` (damage maths), `analysis`,
  `rules`, `suggest`, `optimize`, `moves`, `counter`, `roles`, `teamsets`, `games`, `realdamage`, `search`. The future "best team for a game" and "counter this enemy team" features build on this.
- `src/ui/` – React components.

## Adding a rule

Add a `RuleDef` to `RULE_DEFS` in `src/engine/rules.ts` (`speciesCheck` for per-Pokémon limits, `teamCheck`
for whole-team limits). The rules panel, picker filtering and validation pick it up automatically.

## Roadmap

1. Game-specific rules (Let's Go has no abilities or items, Legends: Arceus mechanics, in-game level caps).
2. Smarter enemy input (gym leader and Elite Four teams per game, pasting a Showdown team) and held-item suggestions.
3. Tera in the optimizer and the enemy-tab damage tables.
