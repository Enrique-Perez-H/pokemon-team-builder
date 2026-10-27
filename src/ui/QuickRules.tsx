import { QUICK_RULES, hasQuick, ruleDef, toggleQuick } from '../engine/rules';
import type { RuleInstance } from '../engine/rules';

interface Props {
  rules: RuleInstance[];
  onChange: (rules: RuleInstance[]) => void;
  /** Heading shown above the toggles. */
  label?: string;
}

/**
 * One-click rule toggles (No legendaries, No Paradox, Fully evolved…). Shown in the rules panel and right beside every
 * "build a team" button, so the limits that apply are visible where the team is requested.
 */
export function QuickRules({ rules, onChange, label }: Props) {
  const others = rules
    .filter((r) => r.enabled && !QUICK_RULES.some((q) => q.type === r.type) && r.type !== 'species_clause' && r.type !== 'game_dex')
    .map((r) => ruleDef(r.type)?.label)
    .filter(Boolean);
  return (
    <div className="quick-rules">
      {label && <b className="quick-label">{label}</b>}
      <div className="quick-grid">
        {QUICK_RULES.map((q) => (
          <button
            key={q.label}
            className={`chip quick${hasQuick(rules, q) ? ' on' : ''}`}
            aria-pressed={hasQuick(rules, q)}
            title={q.hint}
            onClick={() => onChange(toggleQuick(rules, q))}
          >
            {q.label}
          </button>
        ))}
      </div>
      {others.length > 0 && <small className="muted">Also applying: {others.join(', ')} (edit in Rules).</small>}
    </div>
  );
}
