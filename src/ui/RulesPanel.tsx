import { useMemo, useState } from 'react';
import { PRESETS, QUICK_RULES, RULE_DEFS, hasQuick, newRule, ruleDef, toggleQuick } from '../engine/rules';
import type { ParamDef, RuleInstance } from '../engine/rules';
import { speciesPool, typesIn } from '../engine/data';
import { GAME_BY_ID } from '../engine/games';
import type { Generation, TypeName } from '../engine/data';
import { TypeFilter } from './common';

interface Props {
  gen: Generation;
  rules: RuleInstance[];
  violated: Set<string>;
  onChange: (rules: RuleInstance[]) => void;
}

function SpeciesList({ gen, value, onChange }: { gen: Generation; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const names = useMemo(() => [...new Set(speciesPool(gen, true).map((s) => String(s.baseSpecies || s.name)))].sort(), [gen]);
  const add = (n: string) => {
    const hit = names.find((x) => x.toLowerCase() === n.trim().toLowerCase());
    if (hit && !value.includes(hit)) onChange([...value, hit]);
    setText('');
  };
  return (
    <div>
      <div className="chip-row">
        {value.map((n) => (
          <span key={n} className="move-chip">{n}<button className="icon-btn tiny" onClick={() => onChange(value.filter((x) => x !== n))} aria-label={`Unban ${n}`}>✕</button></span>
        ))}
      </div>
      <input
        list="species-names" placeholder="Type a name and press Enter…" value={text}
        onChange={(e) => { setText(e.target.value); if (names.includes(e.target.value)) add(e.target.value); }}
        onKeyDown={(e) => e.key === 'Enter' && add(text)}
      />
      <datalist id="species-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
    </div>
  );
}

function ParamEditor({ gen, def, value, onChange }: { gen: Generation; def: ParamDef; value: unknown; onChange: (v: unknown) => void }) {
  if (def.kind === 'types') {
    return <TypeFilter types={typesIn(gen)} value={value as TypeName[]} onChange={onChange} />;
  }
  if (def.kind === 'gens') {
    const v = value as number[];
    return (
      <div className="chip-row">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => (
          <button key={g} className={`chip${v.includes(g) ? ' on' : ''}`} onClick={() => onChange(v.includes(g) ? v.filter((x) => x !== g) : [...v, g])}>
            Gen {g}
          </button>
        ))}
      </div>
    );
  }
  if (def.kind === 'select') {
    return (
      <label className="num">
        {def.label}
        <select value={value as string} onChange={(e) => onChange(e.target.value)}>
          {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  if (def.kind === 'species') {
    return <SpeciesList gen={gen} value={value as string[]} onChange={onChange} />;
  }
  return (
    <label className="num">
      {def.label}
      <input type="number" min={def.min} max={def.max} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function RulesPanel({ gen, rules, violated, onChange }: Props) {
  const update = (id: string, patch: Partial<RuleInstance>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // Quick options already shown above are not repeated as plain rule cards.
  const active = rules.filter((r) => ruleDef(r.type));
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Rules</h2>
        <select
          className="preset-select" value=""
          onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) onChange([...rules.filter((r) => r.type === 'game_dex'), ...p.build()]); }}
          title="Replace all rules with a preset"
        >
          <option value="">Presets…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id} title={p.description}>{p.label}</option>)}
        </select>
      </div>

      <div className="quick-grid">
        {QUICK_RULES.map((q) => (
          <button key={q.label} className={`chip quick${hasQuick(rules, q) ? ' on' : ''}`} title={q.hint} onClick={() => onChange(toggleQuick(rules, q))}>
            {q.label}
          </button>
        ))}
      </div>

      {active.length === 0 && <p className="muted">No rules — anything goes.</p>}
      {active.map((r) => {
        const def = ruleDef(r.type)!;
        return (
          <div key={r.id} className={`rule${violated.has(r.id) ? ' violated' : ''}${r.enabled ? '' : ' off'}`}>
            <div className="rule-head">
              <label className="check">
                <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, { enabled: e.target.checked })} />
                <strong>{r.type === 'game_dex' && GAME_BY_ID[r.params.game as string] ? `Only Pokémon in ${GAME_BY_ID[r.params.game as string].label}` : def.label}</strong>
              </label>
              <button className="icon-btn tiny" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} aria-label="Delete rule">✕</button>
            </div>
            <small className="muted">{def.description}</small>
            {def.params.map((p) => (
              <ParamEditor key={p.key} gen={gen} def={p} value={r.params[p.key]} onChange={(v) => update(r.id, { params: { ...r.params, [p.key]: v } })} />
            ))}
          </div>
        );
      })}
      <select className="add-rule" value="" onChange={(e) => e.target.value && onChange([...rules, newRule(e.target.value)])}>
        <option value="">+ Add rule…</option>
        {RULE_DEFS.filter((d) => d.type !== 'game_dex').map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
      </select>
    </section>
  );
}
