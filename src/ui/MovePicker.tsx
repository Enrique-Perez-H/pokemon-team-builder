import { useEffect, useMemo, useState } from 'react';
import { learnableMoves, typesIn } from '../engine/data';
import type { Generation, Move, TypeName } from '../engine/data';
import { Modal, TypeBadge, TypeFilter } from './common';

type Cat = 'All' | 'Physical' | 'Special' | 'Status';

interface Props {
  gen: Generation;
  species: string;
  speciesTypes: TypeName[];
  chosen: string[];
  onPick: (move: string) => void;
  onClose: () => void;
}

export function MovePicker({ gen, species, speciesTypes, chosen, onPick, onClose }: Props) {
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat>('All');
  const [types, setTypes] = useState<TypeName[]>([]);

  useEffect(() => {
    let live = true;
    learnableMoves(gen, species).then((m) => live && setMoves(m));
    return () => { live = false; };
  }, [gen, species]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (moves ?? [])
      .filter((m) => !needle || m.name.toLowerCase().includes(needle))
      .filter((m) => cat === 'All' || m.category === cat)
      .filter((m) => !types.length || types.includes(m.type))
      .sort((a, b) => (b.basePower || 0) - (a.basePower || 0) || a.name.localeCompare(b.name));
  }, [moves, q, cat, types]);

  return (
    <Modal title={`${species} — choose a move`} onClose={onClose} wide>
      <div className="picker-controls">
        <input autoFocus placeholder="Search moves…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value as Cat)}>
          {(['All', 'Physical', 'Special', 'Status'] as Cat[]).map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <TypeFilter types={typesIn(gen)} value={types} onChange={setTypes} />
      {!moves ? (
        <p className="muted">Loading learnset…</p>
      ) : (
        <>
          <div className="muted count">{rows.length} of {moves.length} moves</div>
          <table className="move-table">
            <thead>
              <tr><th>Move</th><th>Type</th><th>Cat.</th><th>Pow</th><th>Acc</th><th>PP</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const taken = chosen.includes(m.name);
                return (
                  <tr key={m.id} className={taken ? 'taken' : ''} onClick={() => !taken && onPick(m.name)} title={m.shortDesc}>
                    <td>
                      {m.name}
                      {speciesTypes.includes(m.type) && m.category !== 'Status' && <span className="stab">STAB</span>}
                    </td>
                    <td><TypeBadge type={m.type} small /></td>
                    <td className="muted">{m.category}</td>
                    <td>{m.basePower || '—'}</td>
                    <td>{m.accuracy === true ? '—' : m.accuracy}</td>
                    <td>{m.pp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
