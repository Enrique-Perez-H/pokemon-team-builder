import { useState } from 'react';
import type { Generation } from '../engine/data';
import { DEFAULT_WEIGHTS } from '../engine/optimize';
import { optimizeBalanced, optimizeVsFoes, pickThreats } from '../engine/search';
import type { OptimizedTeam, Weights } from '../engine/optimize';
import type { RuleInstance } from '../engine/rules';
import { Sprite } from './common';
import { QuickRules } from './QuickRules';
import type { Format } from '../engine/roles';
import { slotsFromResult } from './state';
import type { Slot } from './state';

interface Props {
  gen: Generation;
  megas: boolean;
  rules: RuleInstance[];
  slots: (Slot | null)[];
  onApply: (slots: (Slot | null)[]) => void;
  onLockAll: (locked: boolean) => void;
  onRules: (rules: RuleInstance[]) => void;
  format: Format;
}

const LABELS: Record<keyof Weights, string> = {
  defense: 'Defense',
  offense: 'Offense coverage',
  stats: 'Raw stats',
  roles: 'Team roles',
};

const WEIGHT_PRESETS: { label: string; w: Weights }[] = [
  { label: 'Balanced', w: { defense: 1, offense: 1, stats: 1, roles: 1 } },
  { label: 'Hard-hitting', w: { defense: 0.5, offense: 2, stats: 1, roles: 0.5 } },
  { label: 'Defensive', w: { defense: 2, offense: 0.5, stats: 1, roles: 1.5 } },
  { label: 'Support-rich', w: { defense: 1, offense: 0.5, stats: 0.5, roles: 3 } },
  { label: 'Raw power', w: { defense: 0.5, offense: 0.5, stats: 3, roles: 0 } },
];

export function OptimizerPanel({ gen, megas, rules, slots, onApply, onLockAll, onRules, format }: Props) {
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [results, setResults] = useState<OptimizedTeam[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [threats, setThreats] = useState(false);
  const [progress, setProgress] = useState(0);
  const [benchmark, setBenchmark] = useState<string[] | null>(null);
  const [applying, setApplying] = useState(false);

  const filled = slots.filter(Boolean).length;
  const kept = slots.filter((s) => s?.locked).length;
  const lockedSlots = slots.map((s) => (s?.locked ? s : null));

  const run = async () => {
    setBusy(true);
    setResults(null);
    setBenchmark(null);
    setProgress(0);
    try {
      const locked = lockedSlots.map((s) => (s ? gen.species.get(s.species) ?? null : null));
      if (threats) {
        // Real-damage mode: judge teams against the strongest Pokémon these rules allow.
        const foes = pickThreats(gen, rules, megas, 10);
        const r = await optimizeVsFoes({ gen, rules, locked, megas, foes, weights, real: true, generalShare: 1, format, onProgress: setProgress });
        setBenchmark(foes.map((f) => f.name));
        setResults(r.teams);
      } else {
        setResults(await optimizeBalanced({ gen, rules, locked, megas, weights, format }));
      }
    } finally {
      setBusy(false);
    }
  };

  const apply = async (team: OptimizedTeam) => {
    setApplying(true);
    onApply(await slotsFromResult(gen, team, lockedSlots, undefined, format));
    setApplying(false);
    setResults(null);
  };

  return (
    <section className="panel optimizer">
      <h2>Team optimizer</h2>
      <p className="muted">
        Searches every Pokémon allowed by your rules for the team with the best defensive profile,
        type coverage and stats, then picks abilities and movesets (attacks plus hazards, recovery, pivots and setup).
      </p>
      <QuickRules rules={rules} onChange={onRules} label="Which Pokémon can be used?" />
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
        <label className="check" title="Also scores each team on real damage against the 10 strongest Pokémon your rules allow, so it picks Pokémon that can actually beat and survive them.">
          <input type="checkbox" checked={threats} onChange={(e) => { setThreats(e.target.checked); setResults(null); }} />
          Test against top threats (real damage)
        </label>
        {threats && <small className="muted">“Top threats” are the strongest Pokémon your rules allow. Add rules like No legendaries to make the benchmark realistic.</small>}
        <button className="btn primary" disabled={busy || applying} onClick={run}>
          {busy ? (threats ? `Calculating damage… ${Math.round(progress * 100)}%` : 'Searching…') : kept ? 'Fill the other slots' : 'Build best team'}
        </button>
      </div>
      {results && results.length === 0 && (
        <p className="insight bad">No team satisfies these rules. Try relaxing one.</p>
      )}
      {results && results.length > 0 && benchmark && (
        <small className="muted">Benchmarked against: {benchmark.join(', ')}.</small>
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
              {!benchmark && (
                <div className="opt-parts muted">
                  Def {r.parts.defense.toFixed(1)} · Off {r.parts.offense.toFixed(1)} · Stats {r.parts.stats.toFixed(1)} · Roles {r.parts.roles.toFixed(1)}
                </div>
              )}
              <button className="btn primary" disabled={applying} onClick={() => apply(r)}>Use this team</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
