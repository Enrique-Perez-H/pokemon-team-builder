import { useEffect, useMemo, useState } from 'react';
import { getGen } from '../engine/data';
import type { Generation } from '../engine/data';
import { GAME_BY_ID, GAME_LIST } from '../engine/games';
import { ROLE_ORDER, loadTrainers, trainerLabel, trainerSlots } from '../engine/trainers';
import type { Trainer } from '../engine/trainers';
import type { Slot } from '../engine/team';
import { Modal, Sprite } from './common';

interface Props {
  gen: Generation;
  /** The game selected in the builder, which is where the list starts. */
  game?: string;
  onClose: () => void;
  onEnemy: (names: string[], sets: Record<string, Slot>) => void;
  /** Called before loading when the trainer uses Pokémon outside the selected game or generation. */
  onSwitchToAll: () => void;
}

/** Load a gym leader, Elite Four member, Champion or Kahuna's team, with their real levels, moves, abilities and items. */
export function TrainerPicker({ gen, game, onClose, onEnemy, onSwitchToAll }: Props) {
  const [gameId, setGameId] = useState(game ?? 'red-blue');
  const [trainers, setTrainers] = useState<Trainer[] | null>(null);
  useEffect(() => {
    let live = true;
    setTrainers(null);
    loadTrainers(gameId, import.meta.env.BASE_URL).then((t) => { if (live) setTrainers(t); });
    return () => { live = false; };
  }, [gameId]);

  const gameGen = useMemo(() => getGen(GAME_BY_ID[gameId].gen, gameId), [gameId]);
  const groups = ROLE_ORDER.map((role) => ({ role, list: (trainers ?? []).filter((t) => t.role === role) })).filter((g) => g.list.length);

  const load = (t: Trainer) => {
    const { slots } = trainerSlots(gameGen, t);
    const sets: Record<string, Slot> = {};
    for (const s of slots) sets[s.species] = s;
    // Switch to every generation when the builder's current setting lacks any of these Pokémon.
    if (slots.some((s) => !gen.species.get(s.species))) onSwitchToAll();
    onEnemy(slots.map((s) => s.species), sets);
    onClose();
  };

  return (
    <Modal title="Load a gym leader or Elite Four team" onClose={onClose} wide>
      <label className="field">Game
        <select value={gameId} onChange={(e) => setGameId(e.target.value)} aria-label="Game">
          {GAME_LIST.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </label>
      {trainers === null && <p className="muted" role="status">Loading…</p>}
      {trainers && !trainers.length && <p className="muted">No trainer teams are recorded for this game.</p>}
      {groups.map((g) => (
        <section key={g.role}>
          <h4>{g.role === 'Elite Four' ? 'Elite Four' : `${g.role}s`}</h4>
          <div className="trainer-list">
            {g.list.map((t, i) => (
              <button key={i} className="trainer-card" onClick={() => load(t)} aria-label={`${trainerLabel(t)}, ${t.location}`}>
                <strong>{trainerLabel(t)}</strong>
                <small className="muted">{t.location}</small>
                <span className="trainer-team">
                  {t.team.map((m, k) => <Sprite key={k} name={m.species + (m.form ?? '')} size={34} />)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <small className="muted">Teams from <a href="https://bulbapedia.bulbagarden.net/" target="_blank" rel="noreferrer">Bulbapedia</a> (CC BY-NC-SA 2.5). Shown in the order they are fought; repeat battles have stronger teams.</small>
    </Modal>
  );
}
