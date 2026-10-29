import { useEffect, useRef, useState } from 'react';
import { ALL_GENS, getGen, learnableMoves } from '../engine/data';
import type { Generation } from '../engine/data';
import { parseTeamImage, slotFromParsed } from '../engine/screenshot';
import type { ParsedMon } from '../engine/screenshot';
import type { Slot } from '../engine/team';
import { Modal, Sprite } from './common';
import { MovePicker } from './MovePicker';
import { PokemonPicker } from './PokemonPicker';
import { disposeOcr, readImageText } from './ocr';
import type { OcrProgress } from './ocr';
import { TEAM_SIZE } from './state';

interface Props {
  gen: Generation;
  /** Where the result goes: your own team, or the enemy team (with their known sets). */
  target: 'team' | 'enemy';
  onClose: () => void;
  onTeam?: (slots: (Slot | null)[]) => void;
  onEnemy?: (names: string[], sets: Record<string, Slot>) => void;
  /** Called before loading when Pokémon outside the selected game or generation are included. */
  onSwitchToAll?: () => void;
}

type Row = ParsedMon & { include: boolean; changed?: boolean };
type Stage = 'idle' | 'reading' | 'review' | 'failed';

/**
 * Load a team from a screenshot of a team card. The picture is read in the browser (nothing is uploaded), then shown
 * for review: every Pokémon can be corrected or left out before the team is loaded.
 */
export function ScreenshotImport({ gen, target, onClose, onTeam, onEnemy, onSwitchToAll }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState<OcrProgress>({ fraction: 0, label: '' });
  const [preview, setPreview] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [picking, setPicking] = useState<number | null>(null);
  const [addMove, setAddMove] = useState<number | null>(null);
  const [switchAll, setSwitchAll] = useState(true);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: Blob) => {
    if (!file.type.startsWith('image/')) {
      setMessage('That file is not a picture. Choose a PNG, JPEG or WebP image.');
      setStage('failed');
      return;
    }
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(file); });
    setStage('reading');
    setProgress({ fraction: 0, label: 'Starting…' });
    try {
      const ocr = await readImageText(file, setProgress);
      const result = await parseTeamImage(ocr.words, {
        gen,
        // Pokémon the chosen game lacks still get their moves matched against everything they can learn.
        learnable: async (species) => {
          const own = await learnableMoves(gen, species);
          return (own.length ? own : await learnableMoves(getGen(ALL_GENS), species)).map((m) => m.name);
        },
      }, { width: ocr.width, height: ocr.height });
      setWarnings(result.warnings);
      if (!result.mons.length) {
        setMessage(result.warnings[0] ?? 'No Pokémon could be read from this picture.');
        setStage('failed');
        return;
      }
      setRows(result.mons.map((m) => ({ ...m, include: true })));
      setStage('review');
    } catch (e) {
      setMessage(`Reading the picture failed${e instanceof Error ? `: ${e.message}` : '.'}`);
      setStage('failed');
    }
  };

  // Paste a screenshot straight from the clipboard while the dialog is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); read(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { disposeOcr(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const chosen = rows.filter((r) => r.include);
  // Pokémon the selected game or generation does not have (a gym leader's older team, say) can still be loaded by
  // switching to "Every generation".
  const missing = chosen.filter((r) => !gen.species.get(r.species));
  const apply = () => {
    const widen = missing.length > 0 && switchAll;
    const useGen = widen ? getGen(ALL_GENS) : gen;
    if (widen) onSwitchToAll?.();
    const slots = chosen.map((r) => slotFromParsed(useGen, r)).filter((s): s is Slot => !!s);
    if (target === 'team') {
      onTeam?.(Array.from({ length: TEAM_SIZE }, (_, i) => slots[i] ?? null));
    } else {
      const sets: Record<string, Slot> = {};
      for (const s of slots) sets[s.species] = s;
      onEnemy?.(slots.map((s) => s.species), sets);
    }
    onClose();
  };

  const title = target === 'team' ? 'Load my team from a screenshot' : 'Load the enemy team from a screenshot';

  return (
    <Modal title={title} onClose={onClose} wide>
      {(stage === 'idle' || stage === 'failed') && (
        <>
          <div
            className={`dropzone${dragging ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) read(f); }}
          >
            <p><strong>Drop a picture of a team here</strong>, paste one (Ctrl/⌘+V), or</p>
            <button className="btn primary" onClick={() => input.current?.click()}>Choose a picture</button>
            <input
              ref={input} type="file" accept="image/*" hidden aria-label="Team screenshot"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }}
            />
            <small className="muted">
              Works best with a clear screenshot of a team card: names, moves, items and natures are read; levels and EVs when they
              are legible. The picture is read on your device and never uploaded.
            </small>
          </div>
          {stage === 'failed' && <div className="insight bad" role="alert">{message}</div>}
        </>
      )}

      {stage === 'reading' && (
        <div className="reading" role="status">
          {preview && <img className="shot-preview" src={preview} alt="The picture being read" />}
          <div className="progress"><i style={{ width: `${Math.round(progress.fraction * 100)}%` }} /></div>
          <p className="muted">{progress.label} {Math.round(progress.fraction * 100)}%</p>
          <small className="muted">The first time, the text reader (about 7 MB) is downloaded; after that it works offline.</small>
        </div>
      )}

      {stage === 'review' && (
        <>
          <div className="review-head">
            {preview && <img className="shot-preview small" src={preview} alt="Your picture" />}
            <p className="muted">
              Check what was read before loading it. Fix a wrong Pokémon with <b>Change</b>, or untick one to leave it out.
              Anything not read from the picture is filled in with a standard build.
            </p>
          </div>
          {warnings.map((w, i) => <div key={i} className="insight warn">! {w}</div>)}
          {missing.length > 0 && (
            <div className="insight warn">
              <label className="check">
                <input type="checkbox" checked={switchAll} onChange={(e) => setSwitchAll(e.target.checked)} />
                <span>
                  {missing.map((r) => r.species).join(', ')} {missing.length === 1 ? 'is' : 'are'} not in the selected game or generation.
                  Switch to <b>Every generation</b> so {missing.length === 1 ? 'it loads' : 'they load'}
                  {switchAll ? '.' : ' (otherwise they are skipped).'}
                </span>
              </label>
            </div>
          )}
          <div className="review-list">
            {rows.map((r, i) => (
              <div key={i} className={`review-row${r.include ? '' : ' off'}`}>
                <label className="check" title="Include this Pokémon">
                  <input type="checkbox" checked={r.include} onChange={(e) => setRows((cur) => cur.map((x, k) => (k === i ? { ...x, include: e.target.checked } : x)))} />
                </label>
                <Sprite name={r.species} size={52} />
                <div className="review-info">
                  <div className="review-title">
                    <strong>{r.species}</strong>
                    <label className="lv">Lv
                      <input
                        type="number" min={1} max={100} placeholder="100" value={r.level ?? ''} aria-label={`${r.species} level`}
                        onChange={(e) => setRows((cur) => cur.map((x, k) => (k === i ? { ...x, level: e.target.value ? Math.max(1, Math.min(100, Number(e.target.value))) : undefined } : x)))}
                      />
                    </label>
                    {norm(r.read) !== norm(r.species) && !r.changed && <small className="muted">read as “{r.read}”</small>}
                    <button className="chip" onClick={() => setPicking(i)}>Change</button>
                  </div>
                  <small className="muted">
                    {[r.nature, r.ability, r.item].filter(Boolean).join(' · ') || 'No nature, ability or item read'}
                    {r.evs ? ' · EVs read' : ''}
                  </small>
                  <div className="chip-row">
                    {r.moves.map((m) => (
                      <span key={m} className="move-chip">{m}
                        <button className="icon-btn tiny" aria-label={`Remove ${m}`} onClick={() => setRows((cur) => cur.map((x, k) => (k === i ? { ...x, moves: x.moves.filter((y) => y !== m) } : x)))}>✕</button>
                      </span>
                    ))}
                    {r.moves.length < 4 && <button className="chip" onClick={() => setAddMove(i)}>+ Move</button>}
                    {!r.moves.length && <small className="muted">No moves read; add some, or they are suggested.</small>}
                  </div>
                  {r.notes.map((n, k) => <small key={k} className="issue">⚠ {n}</small>)}
                </div>
              </div>
            ))}
          </div>
          <div className="build-actions">
            <button className="btn" onClick={() => { setStage('idle'); setRows([]); }}>Try another picture</button>
            <button className="btn primary" disabled={!chosen.length} onClick={apply}>
              {target === 'team' ? `Load ${chosen.length} into my team` : `Use ${chosen.length} as the enemy team`}
            </button>
          </div>
        </>
      )}

      {addMove !== null && rows[addMove] && (
        <MovePicker
          gen={missing.some((r) => r.species === rows[addMove].species) ? getGen(ALL_GENS) : gen}
          species={rows[addMove].species}
          speciesTypes={(getGen(ALL_GENS).species.get(rows[addMove].species)?.types ?? []) as never}
          chosen={rows[addMove].moves}
          onPick={(m) => { setRows((cur) => cur.map((x, k) => (k === addMove ? { ...x, moves: [...x.moves, m].slice(0, 4) } : x))); setAddMove(null); }}
          onClose={() => setAddMove(null)}
        />
      )}

      {picking !== null && (
        <PokemonPicker
          gen={gen} megas rules={[]} slots={Array(TEAM_SIZE).fill(null)} slot={0} suggestions={[]}
          onPick={(name) => {
            setRows((cur) => cur.map((x, k) => (k === picking ? { ...x, species: name, changed: true, notes: [...x.notes.filter((n) => !/not in the data/.test(n)), 'Pokémon chosen by you.'], moves: x.moves.filter((m) => gen.moves.get(m)) } : x)));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </Modal>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
