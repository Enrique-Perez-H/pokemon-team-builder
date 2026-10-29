import { useState } from 'react';
import { GAMES } from '../engine/data';
import { GAME_BY_ID } from '../engine/games';
import type { Generation } from '../engine/data';
import { exportTeam, importTeam } from '../engine/showdown';
import { Modal, Sprite } from './common';
import { ScreenshotImport } from './ScreenshotImport';
import { buildFor, shareUrl, useSavedTeams } from './state';
import type { BuilderState, Slot } from './state';

interface Props {
  gen: Generation;
  state: BuilderState;
  setState: (fn: (s: BuilderState) => BuilderState) => void;
}

const genLabel = (g: number, game?: string) =>
  game && GAME_BY_ID[game] ? GAME_BY_ID[game].label : g === 0 ? 'Every generation' : GAMES.find((x) => x.gen === g)?.label ?? `Gen ${g}`;

/** Header actions: saved teams, Showdown import/export and a share link. */
export function TeamMenu({ gen, state, setState }: Props) {
  const [open, setOpen] = useState<'teams' | 'text' | 'shot' | null>(null);
  const [name, setName] = useState(state.name);
  const [paste, setPaste] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const saved = useSavedTeams();

  const exportText = exportTeam(gen, state.slots, (s: Slot) => {
    const sp = gen.species.get(s.species)!;
    const mv = s.moves.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; });
    return buildFor(gen, s, sp, mv);
  });

  const flash = (text: string) => { setNote(text); setTimeout(() => setNote(''), 2500); };
  const copy = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); flash(done); } catch { flash('Copy failed — select the text and copy it manually.'); }
  };

  const doImport = () => {
    const { slots, warnings: w } = importTeam(gen, paste);
    setWarnings(w);
    if (!slots.length) return;
    setState((st) => ({ ...st, slots: Array.from({ length: st.slots.length }, (_, i) => slots[i] ?? null) }));
    setPaste('');
    if (!w.length) setOpen(null);
  };

  return (
    <>
      <button className="btn" onClick={() => { setName(state.name); setOpen('teams'); }}>My teams</button>
      <button className="btn" onClick={() => { setWarnings([]); setOpen('text'); }}>Import / export</button>
      <button className="btn" onClick={() => setOpen('shot')} title="Load a team from a picture of a team card">📷 From screenshot</button>
      <button className="btn" onClick={() => copy(shareUrl(state), 'Link copied — anyone with it sees this team.')}>Share link</button>
      {note && <span className="toast" role="status">{note}</span>}

      {open === 'shot' && (
        <ScreenshotImport
          gen={gen} target="team" onClose={() => setOpen(null)}
          onSwitchToAll={() => setState((st) => ({ ...st, gen: 0, game: undefined, rules: st.rules.filter((r) => r.type !== 'game_dex') }))}
          onTeam={(slots) => setState((st) => ({ ...st, slots }))}
        />
      )}

      {open === 'teams' && (
        <Modal title="My teams" onClose={() => setOpen(null)}>
          <div className="save-row">
            <input placeholder="Team name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" disabled={!state.slots.some(Boolean)} onClick={() => { saved.save(name, state); setState((s) => ({ ...s, name: name.trim() || 'Untitled team' })); flash('Saved'); }}>
              Save current team
            </button>
          </div>
          {saved.teams.length === 0 && <p className="muted">No saved teams yet. They are stored in this browser.</p>}
          {saved.teams.map((t) => (
            <div key={t.id} className="saved-team">
              <div className="saved-info">
                <strong>{t.name}</strong>
                <small className="muted">{genLabel(t.state.gen, t.state.game)} · {new Date(t.savedAt).toLocaleDateString()}</small>
                <div className="saved-mons">{t.state.slots.map((s, i) => s && <Sprite key={i} name={s.species} size={32} />)}</div>
              </div>
              <button className="btn" onClick={() => { setState(() => ({ ...t.state, name: t.name })); setOpen(null); }}>Load</button>
              <button className="icon-btn" onClick={() => saved.remove(t.id)} aria-label={`Delete ${t.name}`}>✕</button>
            </div>
          ))}
        </Modal>
      )}

      {open === 'text' && (
        <Modal title="Import / export" onClose={() => setOpen(null)} wide>
          <div className="io-grid">
            <div>
              <h3>Export</h3>
              <p className="muted">Pokémon Showdown format: paste it into Showdown, damage calculators or any team tool.</p>
              <textarea readOnly value={exportText || 'Add Pokémon to your team first.'} rows={14} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn" disabled={!exportText} onClick={() => copy(exportText, 'Team copied')}>Copy team</button>
            </div>
            <div>
              <h3>Import</h3>
              <p className="muted">Paste a Showdown team. It replaces your current team.</p>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={14} placeholder={'Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 252 Atk / 4 HP / 252 Spe\nJolly Nature\n- Earthquake\n- Outrage'} />
              <button className="btn primary" disabled={!paste.trim()} onClick={doImport}>Import team</button>
              {warnings.map((w, i) => <div key={i} className="issue">⚠ {w}</div>)}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
