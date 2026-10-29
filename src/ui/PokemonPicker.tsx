import { useMemo, useState } from 'react';
import { STATS, STAT_LABEL, bst, speciesPool, typesIn } from '../engine/data';
import type { Generation, Specie, StatKey, TypeName } from '../engine/data';
import { speciesViolations, wouldViolate } from '../engine/rules';
import type { RuleInstance } from '../engine/rules';
import type { Suggestion } from '../engine/suggest';
import { Modal, Sprite, TypeBadge, TypeFilter } from './common';

type Sort = 'dex' | 'bst' | StatKey;
const PAGE = 120;

interface Props {
  gen: Generation;
  megas: boolean;
  rules: RuleInstance[];
  slots: (Specie | null)[];
  slot: number;
  suggestions: Suggestion[];
  onPick: (name: string) => void;
  onClose: () => void;
}

export function PokemonPicker({ gen, megas, rules, slots, slot, suggestions, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<TypeName[]>([]);
  const [sort, setSort] = useState<Sort>('dex');
  const [showBlocked, setShowBlocked] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = speciesPool(gen, megas)
      .filter((s) => !needle || s.name.toLowerCase().includes(needle))
      .filter((s) => !types.length || types.every((t) => s.types.includes(t)))
      .map((s) => {
        const reasons = [
          ...speciesViolations(rules, s),
          ...wouldViolate(rules, slots, s, slot).filter((r) => !speciesViolations(rules, s).includes(r)),
        ];
        return { s, reasons };
      })
      .filter((r) => showBlocked || r.reasons.length === 0);
    const val = (s: Specie) => (sort === 'dex' ? s.num : sort === 'bst' ? -bst(s) : -s.baseStats[sort]);
    return list.sort((a, b) => val(a.s) - val(b.s));
  }, [gen, megas, rules, slots, slot, q, types, sort, showBlocked]);

  return (
    <Modal title={`Choose Pokémon — slot ${slot + 1}`} onClose={onClose} wide>
      {/* Suggestions help while browsing; once you search or filter they only push your results out of view. */}
      {suggestions.length > 0 && !q.trim() && !types.length && (
        <div className="suggest-strip">
          <span className="muted">Suggested for this team</span>
          <div className="suggest-row">
            {suggestions.map((sg) => (
              <button key={sg.species.name} className="suggest" onClick={() => onPick(sg.species.name)}>
                <Sprite name={sg.species.name} size={48} types={sg.species.types} />
                <div>
                  <strong>{sg.species.name}</strong>
                  <small>{sg.reasons.join(' · ')}</small>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="picker-controls">
        <input autoFocus placeholder="Search by name…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="dex">Sort: Dex #</option>
          <option value="bst">Sort: Base stat total</option>
          {STATS.map((s) => <option key={s} value={s}>Sort: {STAT_LABEL[s]}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
          Show rule-breaking
        </label>
      </div>
      <TypeFilter types={typesIn(gen)} value={types} onChange={(t) => { setTypes(t); setLimit(PAGE); }} />
      <div className="muted count">{rows.length} Pokémon</div>
      <div className="picker-grid">
        {rows.slice(0, limit).map(({ s, reasons }) => (
          <button
            key={s.name}
            className={`pick${reasons.length ? ' blocked' : ''}`}
            title={reasons.join('\n')}
            onClick={() => !reasons.length && onPick(s.name)}
          >
            <Sprite name={s.name} size={56} types={s.types} />
            <strong>{s.name}</strong>
            <div className="badges">{s.types.map((t) => <TypeBadge key={t} type={t} small />)}</div>
            <small className="muted">{reasons.length ? reasons[0] : `BST ${bst(s)}`}</small>
          </button>
        ))}
      </div>
      {rows.length > limit && (
        <button className="btn center" onClick={() => setLimit(limit + PAGE)}>Show more</button>
      )}
    </Modal>
  );
}
