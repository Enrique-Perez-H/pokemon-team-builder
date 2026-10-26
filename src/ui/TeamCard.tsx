import { STATS, STAT_LABEL, abilitiesOf, bst, hasTera } from '../engine/data';
import { computeStats, hasItems, hasNatures } from '../engine/sets';
import type { Build } from '../engine/sets';
import type { Generation } from '../engine/data';
import { memberStats } from '../engine/analysis';
import type { Member } from '../engine/types';
import type { Slot } from './state';
import { Sprite, TypeBadge, TYPE_COLORS } from './common';

interface Props {
  gen: Generation;
  index: number;
  slot: Slot | null;
  member: Member | null;
  issues: string[];
  build: Build | null;
  onEditBuild: () => void;
  onChoose: () => void;
  onToggleLock: () => void;
  onShift: (dir: -1 | 1) => void;
  canShift: { left: boolean; right: boolean };
  onClear: () => void;
  onAbility: (a: string) => void;
  onMove: (moveIndex: number) => void;
  onRemoveMove: (moveIndex: number) => void;
}

export function TeamCard({ gen, index, slot, member, issues, build, onEditBuild, onChoose, onToggleLock, onShift, canShift, onClear, onAbility, onMove, onRemoveMove }: Props) {
  if (!slot || !member) {
    return (
      <button className="card empty" onClick={onChoose}>
        <span className="plus">+</span>
        <span>Add Pokémon</span>
        <small className="muted">Slot {index + 1}</small>
      </button>
    );
  }
  const sp = member.species;
  const abilities = abilitiesOf(gen, sp);
  const stats = memberStats(member);
  const accent = TYPE_COLORS[sp.types[0]];
  const real = build ? computeStats(gen, sp, build) : null;
  return (
    <div className={`card${issues.length ? ' has-issues' : ''}`} style={{ borderTopColor: accent }}>
      <div className="card-head">
        <button className="sprite-btn" onClick={onChoose} title="Change Pokémon">
          <Sprite name={sp.name} size={84} types={sp.types} />
        </button>
        <div className="card-title">
          <strong>{sp.name}</strong>
          <div className="badges">{sp.types.map((t) => <TypeBadge key={t} type={t} />)}</div>
          <small className="muted">{stats.role} · BST {bst(sp)}</small>
        </div>
        <div className="card-actions">
          <button className="icon-btn" onClick={onClear} aria-label="Remove">✕</button>
          <button className={`icon-btn lock${slot.locked ? ' on' : ''}`} onClick={onToggleLock} aria-pressed={!!slot.locked} title={slot.locked ? 'Locked: the optimizer keeps this Pokémon' : 'Lock so the optimizer keeps this Pokémon'}>
            {slot.locked ? '🔒' : '🔓'}
          </button>
          <div className="shift">
            <button className="icon-btn tiny" disabled={!canShift.left} onClick={() => onShift(-1)} aria-label="Move earlier">‹</button>
            <button className="icon-btn tiny" disabled={!canShift.right} onClick={() => onShift(1)} aria-label="Move later">›</button>
          </div>
        </div>
      </div>

      {abilities.length > 0 && (
        <select className="ability" value={slot.ability ?? ''} onChange={(e) => onAbility(e.target.value)}>
          <option value="">Ability: any</option>
          {abilities.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      <div className="moves">
        {[0, 1, 2, 3].map((i) => {
          const mv = member.moves[i];
          return mv ? (
            <div key={i} className="move" style={{ borderLeftColor: TYPE_COLORS[mv.type] }}>
              <button onClick={() => onMove(i)} title={mv.shortDesc}>
                <span>{mv.name}</span>
                <small className="muted">{mv.category === 'Status' ? 'Status' : `${mv.category[0]}·${mv.basePower || '—'}`}</small>
              </button>
              <button className="icon-btn tiny" onClick={() => onRemoveMove(i)} aria-label="Remove move">✕</button>
            </div>
          ) : (
            <button key={i} className="move add" onClick={() => onMove(i)}>+ Move</button>
          );
        })}
      </div>

      {build && (
        <button className="build-summary" onClick={onEditBuild} title="Edit level, nature, EVs, IVs and item">
          <span>{hasNatures(gen) ? build.nature : `Lv ${build.level}`}{hasItems(gen) && build.item ? ` · ${build.item}` : ''}{hasTera(gen) && build.tera ? <> · Tera <TypeBadge type={build.tera} small /></> : ''}</span>
          <small className="muted">Edit build ›</small>
        </button>
      )}

      <div className="stat-bars">
        {STATS.map((k) => {
          const v = sp.baseStats[k];
          return (
            <div key={k} className="stat">
              <span>{STAT_LABEL[k]}</span>
              <div className="bar"><i style={{ width: `${Math.min(100, (v / 200) * 100)}%`, background: v >= 100 ? '#4ecb8d' : v >= 70 ? '#e0c050' : '#e07a5f' }} /></div>
              <b title={`Base ${v}`}>{real ? real[k] : v}</b>
            </div>
          );
        })}
      </div>

      {real && <small className="muted">Bars show base stats; numbers are real stats at level {build!.level}.</small>}
      {issues.map((m, i) => <div key={i} className="issue">⚠ {m}</div>)}
    </div>
  );
}
