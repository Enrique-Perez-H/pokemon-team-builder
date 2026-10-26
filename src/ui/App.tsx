import { useEffect, useMemo, useState } from 'react';
import { ALL_GENS } from '../engine/data';
import { GAME_BY_ID, GAME_LIST, gameData, loadGameData } from '../engine/games';
import { validateTeam } from '../engine/rules';
import { suggestPicks } from '../engine/suggest';
import type { Member } from '../engine/types';
import { AnalysisPanel } from './AnalysisPanel';
import { EnemyTab } from './EnemyTab';
import { BuildEditor } from './BuildEditor';
import { CalcTab } from './CalcTab';
import { MovePicker } from './MovePicker';
import { OptimizerPanel } from './OptimizerPanel';
import { PokemonPicker } from './PokemonPicker';
import { RulesPanel } from './RulesPanel';
import { TeamCard } from './TeamCard';
import { TeamMenu } from './TeamMenu';
import { computeStats, suggestBuild } from '../engine/sets';
import { buildTeamSets } from '../engine/teamsets';
import { buildFor, gameRule, getGen, resolveSlots, useBuilder, useTheme } from './state';
import type { Slot } from './state';

export function App() {
  const { state, setState, reset } = useBuilder();
  const [tab, setTab] = useState<'build' | 'enemy' | 'calc'>('build');
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [buildTarget, setBuildTarget] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ slot: number; index: number } | null>(null);
  const [filling, setFilling] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const [theme, toggleTheme] = useTheme();
  // Game data (Pokédex and movesets) is fetched when a game is first selected; bumping `dataVersion` re-runs checks.
  const [dataVersion, setDataVersion] = useState(0);
  const [loadingGame, setLoadingGame] = useState(false);
  const gen = getGen(state.gen, state.game);
  useEffect(() => {
    const id = state.game;
    if (!id || gameData(id)) return;
    let live = true;
    setLoadingGame(true);
    loadGameData(id, import.meta.env.BASE_URL)
      .then(() => live && setDataVersion((v) => v + 1))
      .catch(() => undefined)
      .finally(() => live && setLoadingGame(false));
    return () => { live = false; };
  }, [state.game]);

  const members = useMemo(() => resolveSlots(gen, state.slots), [gen, state.slots]);
  const speciesSlots = members.map((m) => m?.species ?? null);
  const team = members.filter((m): m is Member => !!m);
  const realStats = members.flatMap((m, i) => (m && state.slots[i] ? [computeStats(gen, m.species, buildFor(gen, state.slots[i]!, m.species, m.moves))] : []));
  const violations = useMemo(() => validateTeam(state.rules, speciesSlots), [state.rules, members, dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const violatedRules = new Set(violations.map((v) => v.ruleId));

  const patchSlot = (i: number, fn: (s: Slot) => Slot | null) =>
    setState((st) => ({ ...st, slots: st.slots.map((s, k) => (k === i && s ? fn(s) : s)) }));

  const choose = (i: number, species: string) => {
    const sp = gen.species.get(species);
    setState((st) => ({
      ...st,
      slots: st.slots.map((s, k) => {
        if (k !== i) return s;
        if (s?.species === species) return s;
        return { species, moves: [], build: sp ? suggestBuild(gen, sp) : undefined };
      }),
    }));
    setPickSlot(null);
  };

  /**
   * Build movesets for the whole team. With `all` false only Pokémon without moves are filled; with `all` true every
   * unlocked Pokémon is rebuilt. Existing sets still count when deciding which support jobs the team needs.
   */
  const autoFill = async (all: boolean) => {
    const idx = state.slots.flatMap((s, i) => (s && gen.species.get(s.species) ? [i] : []));
    if (!idx.length) return;
    setFilling(true);
    try {
      const species = idx.map((i) => gen.species.get(state.slots[i]!.species)!);
      const regenerate = (i: number) => (all ? !state.slots[i]!.locked : state.slots[i]!.moves.length === 0);
      const keep = idx.map((i) => (regenerate(i) ? null : state.slots[i]!.moves));
      const sets = await buildTeamSets(gen, species, { keep });
      setState((st) => ({
        ...st,
        slots: st.slots.map((s, i) => {
          const k = idx.indexOf(i);
          if (!s || k < 0 || !regenerate(i)) return s;
          const sp = species[k];
          const mv = sets[k].flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; });
          return { ...s, moves: sets[k], build: suggestBuild(gen, sp, mv, s.ability) };
        }),
      }));
    } finally {
      setFilling(false);
    }
  };

  const swapSlots = (a: number, b: number) =>
    setState((st) => {
      if (a === b) return st;
      const slots = [...st.slots];
      [slots[a], slots[b]] = [slots[b], slots[a]];
      return { ...st, slots };
    });

  const setLocks = (locked: boolean) =>
    setState((st) => ({ ...st, slots: st.slots.map((s) => (s ? { ...s, locked } : s)) }));

  /** Choose "every generation", a whole generation, or a specific game (value format: all | gen:N | game:id). */
  const selectGame = (value: string) => {
    const game = value.startsWith('game:') ? value.slice(5) : undefined;
    const n = game ? GAME_BY_ID[game].gen : value === 'all' ? ALL_GENS : Number(value.slice(4));
    const next = getGen(n, game);
    setState((st) => ({
      ...st,
      gen: n,
      game,
      megas: game ? GAME_BY_ID[game].megas && st.megas : st.megas,
      // The game rule is managed here: swapped for the new game, or removed when leaving games.
      rules: [...(game ? [gameRule(game)] : []), ...st.rules.filter((r) => r.type !== 'game_dex')],
      // Moves and abilities are game-specific; keep the Pokémon (violations of the new game's Pokédex show on their cards).
      slots: st.slots.map((s) => (s && next.species.get(s.species) ? { species: s.species, moves: [], locked: s.locked } : null)),
      enemy: st.enemy.filter((e) => next.species.get(e)),
    }));
  };

  // Add a Pokémon to the first empty slot (used by the enemy tab's counter suggestions).
  const addToTeam = (species: string) => {
    setState((st) => {
      const i = st.slots.findIndex((s) => !s);
      if (i < 0) return st;
      const sp = gen.species.get(species);
      return { ...st, slots: st.slots.map((s, k) => (k === i ? { species, moves: [], build: sp ? suggestBuild(gen, sp) : undefined } : s)) };
    });
  };

  const suggestions = useMemo(
    () =>
      pickSlot === null
        ? []
        : suggestPicks(gen, state.rules, speciesSlots, team, pickSlot, state.megas),
    [pickSlot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const moveSlot = moveTarget ? state.slots[moveTarget.slot] : null;
  const moveSpecies = moveSlot ? gen.species.get(moveSlot.species) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="top-row">
          <h1>Pokémon Team Builder</h1>
          <input
            className="team-name" placeholder="Team name" value={state.name} aria-label="Team name"
            onChange={(e) => setState((st) => ({ ...st, name: e.target.value }))}
          />
          <div className="top-actions">
            <TeamMenu gen={gen} state={state} setState={setState} />
            <button className="btn" onClick={reset}>New team</button>
            <button className="btn" onClick={toggleTheme} aria-label="Toggle light or dark theme" title="Toggle light/dark theme">{theme === 'light' ? '🌙' : '☀️'}</button>
          </div>
        </div>
        <div className="top-row">
          <nav className="nav-tabs">
            <button className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>Team builder</button>
            <button className={tab === 'enemy' ? 'on' : ''} onClick={() => setTab('enemy')}>
              Counter an enemy team{state.enemy.length ? ` (${state.enemy.length})` : ''}
            </button>
            <button className={tab === 'calc' ? 'on' : ''} onClick={() => setTab('calc')}>Damage calculator</button>
          </nav>
          <div className="controls">
            <label>
              Game
              <select value={state.game ? `game:${state.game}` : state.gen === ALL_GENS ? 'all' : `gen:${state.gen}`} onChange={(e) => selectGame(e.target.value)}>
                <option value="all">Every generation (all Pokémon and moves, modern type chart)</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <optgroup key={n} label={`Generation ${n}`}>
                    <option value={`gen:${n}`}>Any Pokémon up to generation {n}</option>
                    {GAME_LIST.filter((g) => g.gen === n).map((g) => <option key={g.id} value={`game:${g.id}`}>{g.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox" checked={state.megas} disabled={!!state.game && !GAME_BY_ID[state.game].megas}
                onChange={(e) => setState((st) => ({ ...st, megas: e.target.checked }))}
              />
              Allow Mega forms
            </label>
            {loadingGame && <small className="muted" role="status">Loading game data…</small>}
          </div>
        </div>
      </header>

      {tab === 'enemy' && (
        <EnemyTab
          key={dataVersion}
          gen={gen}
          megas={state.megas}
          rules={state.rules}
          slots={state.slots}
          enemy={state.enemy}
          onEnemy={(enemy) => setState((st) => ({ ...st, enemy }))}
          onApply={(slots) => { setState((st) => ({ ...st, slots })); setTab('build'); }}
          onAddToTeam={addToTeam}
          onLockAll={setLocks}
        />
      )}

      {tab === 'calc' && (
        <div className="calc-wrap"><CalcTab gen={gen} slots={state.slots} enemy={state.enemy} /></div>
      )}

      {tab === 'build' && (
      <main className="layout">
        <div className="main-col">
          <div className="team-grid">
            {state.slots.map((slot, i) => (
              <div
                key={i}
                className={`slot-wrap${dragOver === i && dragFrom !== null && dragFrom !== i ? ' over' : ''}`}
                draggable={!!slot}
                onDragStart={() => setDragFrom(i)}
                onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } }}
                onDragLeave={() => setDragOver((o) => (o === i ? null : o))}
                onDrop={() => { if (dragFrom !== null) swapSlots(dragFrom, i); setDragFrom(null); setDragOver(null); }}
                onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
              >
                <TeamCard
                  gen={gen}
                  index={i}
                  slot={slot}
                  member={members[i]}
                  build={slot && members[i] ? buildFor(gen, slot, members[i]!.species, members[i]!.moves) : null}
                  onEditBuild={() => setBuildTarget(i)}
                  issues={violations.filter((v) => v.slots.includes(i)).map((v) => v.message)}
                  onChoose={() => setPickSlot(i)}
                  onClear={() => setState((st) => ({ ...st, slots: st.slots.map((s, k) => (k === i ? null : s)) }))}
                  onAbility={(a) => patchSlot(i, (s) => ({ ...s, ability: a || undefined }))}
                  onMove={(idx) => setMoveTarget({ slot: i, index: idx })}
                  onRemoveMove={(idx) => patchSlot(i, (s) => ({ ...s, moves: s.moves.filter((_, k) => k !== idx) }))}
                  onToggleLock={() => patchSlot(i, (s) => ({ ...s, locked: !s.locked }))}
                  onShift={(dir) => swapSlots(i, i + dir)}
                  canShift={{ left: i > 0, right: i < state.slots.length - 1 }}
                />
              </div>
            ))}
          </div>
          <div className="team-tools">
            <button className="btn" disabled={filling || !team.length} onClick={() => autoFill(false)} title="Give Pokémon without moves a full set: attacks plus the hazards, recovery, pivoting and setup the team needs">
              {filling ? 'Building sets…' : 'Fill empty moves'}
            </button>
            <button className="btn" disabled={filling || !team.length} onClick={() => autoFill(true)} title="Rebuild the moves of every unlocked Pokémon">
              Rebuild all moves
            </button>
            <small className="muted">Sets are built for the whole team: one hazard setter, one remover, recovery, a pivot and setup where they suit.</small>
          </div>
          <AnalysisPanel gen={gen} team={team} real={realStats} />
        </div>
        <aside className="side-col">
          <RulesPanel gen={gen} rules={state.rules} violated={violatedRules} onChange={(rules) => setState((st) => ({ ...st, rules }))} />
          <OptimizerPanel gen={gen} megas={state.megas} rules={state.rules} slots={state.slots} onApply={(slots) => setState((st) => ({ ...st, slots }))} onLockAll={setLocks} />
        </aside>
      </main>
      )}

      {pickSlot !== null && (
        <PokemonPicker
          key={dataVersion}
          gen={gen}
          megas={state.megas}
          rules={state.rules}
          slots={speciesSlots}
          slot={pickSlot}
          suggestions={suggestions}
          onPick={(name) => choose(pickSlot, name)}
          onClose={() => setPickSlot(null)}
        />
      )}
      {buildTarget !== null && state.slots[buildTarget] && members[buildTarget] && (() => {
        const slot = state.slots[buildTarget]!;
        const m = members[buildTarget]!;
        return (
          <BuildEditor
            gen={gen}
            species={m.species}
            build={buildFor(gen, slot, m.species, m.moves)}
            onChange={(b) => patchSlot(buildTarget, (s) => ({ ...s, build: b, ability: b.ability }))}
            onSuggest={() => patchSlot(buildTarget, (s) => {
              const b = suggestBuild(gen, m.species, m.moves, s.ability);
              return { ...s, build: b };
            })}
            onClose={() => setBuildTarget(null)}
          />
        );
      })()}
      {moveTarget && moveSlot && moveSpecies && (
        <MovePicker
          gen={gen}
          species={moveSlot.species}
          speciesTypes={moveSpecies.types}
          chosen={moveSlot.moves}
          onPick={(name) => {
            patchSlot(moveTarget.slot, (s) => {
              const moves = [...s.moves];
              moves[Math.min(moveTarget.index, moves.length)] = name;
              return { ...s, moves };
            });
            setMoveTarget(null);
          }}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </div>
  );
}
