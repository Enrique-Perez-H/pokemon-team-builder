import { useState } from 'react';
import type { Generation } from '../engine/data';
import { DEFAULT_WEIGHTS, optimizeTeam } from '../engine/optimize';
import type { OptimizedTeam, Weights } from '../engine/optimize';
import type { RuleInstance } from '../engine/rules';
import { Sprite } from './common';
import { slotsFromResult } from './state';
import type { Slot } from './state';

interface Props {
  gen: Generation;
  megas: boolean;
  rules: RuleInstance[];
  slots: (Slot | null)[];
  onApply: (slots: (Slot | null)[]) => void;
  onLockAll: (locked: boolean) => void;
}

const LABELS: Record<keyof Weights, string> = {
  defense: 'Defense',
  offense: 'Offense coverage',
  stats: 'Raw stats',
};

const WEIGHT_PRESETS: { label: string; w: Weights }[] = [
  { label: 'Balanced', w: { defense: 1, offense: 1, stats: 1 } },
  { label: 'Hard-hitting', w: { defense: 0.5, offense: 2, stats: 1 } },
  { label: 'Defensive', w: { defense: 2, offense: 0.5, stats: 1 } },
  { label: 'Raw power', w: { defense: 0.5, offense: 0.5, stats: 3 } },
];

export function OptimizerPanel({ gen, megas, rules, slots, onApply, onLockAll }: Props) {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [results, setResults] = useState<OptimizedTeam[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);

  const filled = slots.filter(Boolean).length;
  const kept = slots.filter((s) => s?.locked).length;
  const lockedSlots = slots.map((s) => (s?.locked ? s : null));

  const run = () => {
    setBusy(true);
    setResults(null);
    // Yield so the spinner paints before the (synchronous) search runs.
    setTimeout(() => {
      const locked = lockedSlots.map((s) => (s ? gen.species.get(s.species) ?? null : null));
      setResults(optimizeTeam({ gen, rules, locked, megas, weights }));
      setBusy(false);
    }, 30);
  };

  const apply = async (team: OptimizedTeam) => {
    setApplying(true);
    onApply(await slotsFromResult(gen, team, lockedSlots));
    setApplying(false);
    setResults(null);
  };

  return (
    <section className="panel optimizer">
      <h2>Team optimizer</h2>
      <p className="muted">
        Searches every Pokémon allowed by your rules for the team with the best defensive profile,
        type coverage and stats, then picks abilities and attacking moves.
      </p>
      <div className="chip-row">
        {WEIGHT_PRESETS.map((p) => (
          <button key={p.label} className={`chip${JSON.stringify(p.w) === JSON.stringify(weights) ? ' on' : ''}`} onClick={() => setWeights(p.w)}>{p.label}</button>
        ))}
      </div>
      <div className="weights">
        {(Object.keys(LABELS) as (keyof Weights)[]).map((k) => (
          <label key={k}>
            <span>{LABELS[k]}</span>
            <input type="range" min={0} max={3} step={0.5} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
            <b>{weights[k]}×</b>
          </label>
        ))}
      </div>
      <div className="opt-actions">
        <div className="lock-line">
          <small className="muted">
            {kept ? `${kept} locked 🔒 Pokémon will be kept.` : 'Lock 🔒 a Pokémon on its card to keep it; everything else is rebuilt.'}
          </small>
          {filled > 0 && (
            <span>
              <button className="chip" onClick={() => onLockAll(true)}>Lock all</button>{' '}
              <button className="chip" onClick={() => onLockAll(false)}>Unlock all</button>
            </span>
          )}
        </div>
        <button className="btn primary" disabled={busy || applying} onClick={run}>
          {busy ? 'Searching…' : kept ? 'Fill the other slots' : 'Build best team'}
        </button>
      </div>
      {results && results.length === 0 && (
        <p className="insight bad">No team satisfies these rules. Try relaxing one.</p>
      )}
      {results && results.length > 0 && (
        <div className="opt-results">
          {results.map((r, i) => (
            <div key={i} className="opt-result">
              <div className="opt-rank">#{i + 1}<small>{r.score.toFixed(1)}</small></div>
              <div className="opt-team">
                {r.slots.map((s, k) => (
                  <div key={k} className="opt-mon" title={`${s.name}${r.abilities[k] ? ` (${r.abilities[k]})` : ''}`}>
                    <Sprite name={s.name} size={44} types={s.types} />
                    <small>{s.name}</small>
                  </div>
                ))}
              </div>
              <div className="opt-parts muted">
                Def {r.parts.defense.toFixed(1)} · Off {r.parts.offense.toFixed(1)} · Stats {r.parts.stats.toFixed(1)}
              </div>
              <button className="btn primary" disabled={applying} onClick={() => apply(r)}>Use this team</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
