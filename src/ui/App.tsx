import { useMemo, useState } from 'react';
import { ALL_GENS, GAMES } from '../engine/data';
import { validateTeam } from '../engine/rules';
import { suggestPicks } from '../engine/suggest';
import type { Member } from '../engine/types';
import { AnalysisPanel } from './AnalysisPanel';
import { EnemyTab } from './EnemyTab';
import { MovePicker } from './MovePicker';
import { OptimizerPanel } from './OptimizerPanel';
import { PokemonPicker } from './PokemonPicker';
import { RulesPanel } from './RulesPanel';
import { TeamCard } from './TeamCard';
import { getGen, resolveSlots, useBuilder } from './state';
import type { Slot } from './state';

export function App() {
  const { state, setState, reset } = useBuilder();
  const [tab, setTab] = useState<'build' | 'enemy'>('build');
  const [pickSlot, setPickSlot] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ slot: number; index: number } | null>(null);

  const gen = getGen(state.gen);
  const members = useMemo(() => resolveSlots(gen, state.slots), [gen, state.slots]);
  const speciesSlots = members.map((m) => m?.species ?? null);
  const team = members.filter((m): m is Member => !!m);
  const violations = useMemo(() => validateTeam(state.rules, speciesSlots), [state.rules, members]); // eslint-disable-line react-hooks/exhaustive-deps
  const violatedRules = new Set(violations.map((v) => v.ruleId));

  const patchSlot = (i: number, fn: (s: Slot) => Slot | null) =>
    setState((st) => ({ ...st, slots: st.slots.map((s, k) => (k === i && s ? fn(s) : s)) }));

  const choose = (i: number, species: string) => {
    setState((st) => ({ ...st, slots: st.slots.map((s, k) => (k === i ? { species, moves: s?.species === species ? s.moves : [] } : s)) }));
    setPickSlot(null);
  };

  const setGen = (n: number) =>
    setState((st) => ({
      ...st,
      gen: n,
      // Moves and abilities are generation-specific; keep the species the new generation still has.
      slots: st.slots.map((s) => (s && getGen(n).species.get(s.species) ? { species: s.species, moves: [] } : null)),
      enemy: st.enemy.filter((e) => getGen(n).species.get(e)),
    }));

  // Add a Pokémon to the first empty slot (used by the enemy tab's counter suggestions).
  const addToTeam = (species: string) => {
    setState((st) => {
      const i = st.slots.findIndex((s) => !s);
      if (i < 0) return st;
      return { ...st, slots: st.slots.map((s, k) => (k === i ? { species, moves: [] } : s)) };
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
        <h1>Pokémon Team Builder</h1>
        <nav className="nav-tabs">
          <button className={tab === 'build' ? 'on' : ''} onClick={() => setTab('build')}>Team builder</button>
          <button className={tab === 'enemy' ? 'on' : ''} onClick={() => setTab('enemy')}>
            Counter an enemy team{state.enemy.length ? ` (${state.enemy.length})` : ''}
          </button>
        </nav>
        <div className="controls">
          <label>
            Game
            <select value={state.gen} onChange={(e) => setGen(Number(e.target.value))}>
              {GAMES.map((g) => <option key={g.gen} value={g.gen}>{g.gen === ALL_GENS ? g.label : `Gen ${g.gen} — ${g.label}`}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={state.megas} onChange={(e) => setState((st) => ({ ...st, megas: e.target.checked }))} />
            Allow Mega forms
          </label>
          <button className="btn" onClick={reset}>New team</button>
        </div>
      </header>

      {tab === 'enemy' && (
        <EnemyTab
          gen={gen}
          megas={state.megas}
          rules={state.rules}
          slots={state.slots}
          enemy={state.enemy}
          onEnemy={(enemy) => setState((st) => ({ ...st, enemy }))}
          onApply={(slots) => { setState((st) => ({ ...st, slots })); setTab('build'); }}
          onAddToTeam={addToTeam}
        />
      )}

      {tab === 'build' && (
      <main className="layout">
        <div className="main-col">
          <div className="team-grid">
            {state.slots.map((slot, i) => (
              <TeamCard
                key={i}
                gen={gen}
                index={i}
                slot={slot}
                member={members[i]}
                issues={violations.filter((v) => v.slots.includes(i)).map((v) => v.message)}
                onChoose={() => setPickSlot(i)}
                onClear={() => setState((st) => ({ ...st, slots: st.slots.map((s, k) => (k === i ? null : s)) }))}
                onAbility={(a) => patchSlot(i, (s) => ({ ...s, ability: a || undefined }))}
                onMove={(idx) => setMoveTarget({ slot: i, index: idx })}
                onRemoveMove={(idx) => patchSlot(i, (s) => ({ ...s, moves: s.moves.filter((_, k) => k !== idx) }))}
              />
            ))}
          </div>
          <AnalysisPanel gen={gen} team={team} />
        </div>
        <aside className="side-col">
          <RulesPanel gen={gen} rules={state.rules} violated={violatedRules} onChange={(rules) => setState((st) => ({ ...st, rules }))} />
          <OptimizerPanel gen={gen} megas={state.megas} rules={state.rules} slots={state.slots} onApply={(slots) => setState((st) => ({ ...st, slots }))} />
        </aside>
      </main>
      )}

      {pickSlot !== null && (
        <PokemonPicker
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
