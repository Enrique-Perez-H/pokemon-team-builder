import { RULE_DEFS, newRule, ruleDef } from '../engine/rules';
import type { RuleInstance, ParamDef } from '../engine/rules';
import type { TypeName } from '../engine/data';
import { typesIn } from '../engine/data';
import type { Generation } from '../engine/data';
import { TypeFilter } from './common';

interface Props {
  gen: Generation;
  rules: RuleInstance[];
  violated: Set<string>;
  onChange: (rules: RuleInstance[]) => void;
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
  return (
    <label className="num">
      {def.label}
      <input type="number" min={def.min} max={def.max} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function RulesPanel({ gen, rules, violated, onChange }: Props) {
  const update = (id: string, patch: Partial<RuleInstance>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <section className="panel">
      <h2>Rules</h2>
      {rules.length === 0 && <p className="muted">No rules — anything goes.</p>}
      {rules.map((r) => {
        const def = ruleDef(r.type);
        if (!def) return null;
        return (
          <div key={r.id} className={`rule${violated.has(r.id) ? ' violated' : ''}${r.enabled ? '' : ' off'}`}>
            <div className="rule-head">
              <label className="check">
                <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, { enabled: e.target.checked })} />
                <strong>{def.label}</strong>
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
      <select
        className="add-rule"
        value=""
        onChange={(e) => e.target.value && onChange([...rules, newRule(e.target.value)])}
      >
        <option value="">+ Add rule…</option>
        {RULE_DEFS.map((d) => <option key={d.type} value={d.type}>{d.label}</option>)}
      </select>
    </section>
  );
}
