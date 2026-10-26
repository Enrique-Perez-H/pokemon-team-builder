import { useState } from 'react';
import { STATS, STAT_LABEL } from '../engine/data';
import type { Generation } from '../engine/data';
import { coverageTable, defenseTable, insights, memberStats, teamAverages } from '../engine/analysis';
import type { Member } from '../engine/types';
import { Sprite, TypeBadge, TYPE_COLORS } from './common';

type Tab = 'defense' | 'offense' | 'stats';

function multLabel(m: number) {
  return m === 0 ? '0' : m === 0.25 ? '¼' : m === 0.5 ? '½' : m === 1 ? '' : String(m);
}

function multClass(m: number) {
  return m === 0 ? 'm0' : m < 1 ? 'mres' : m === 1 ? 'mneu' : m === 2 ? 'mweak' : 'mweak2';
}

function Defense({ gen, team }: { gen: Generation; team: Member[] }) {
  const rows = defenseTable(gen, team);
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th>Attack</th>
            {team.map((m, i) => <th key={i} title={m.species.name}><Sprite name={m.species.name} size={32} types={m.species.types} /></th>)}
            <th title="Members weak">Weak</th>
            <th title="Members resisting or immune">Resist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type}>
              <td><TypeBadge type={r.type} small /></td>
              {r.perMember.map((m, i) => <td key={i} className={`cell ${multClass(m)}`}>{multLabel(m)}</td>)}
              <td className={r.weak > r.resist + r.immune ? 'tot bad' : 'tot'}>{r.weak || ''}</td>
              <td className="tot">{r.resist + r.immune || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Offense({ gen, team }: { gen: Generation; team: Member[] }) {
  const rows = coverageTable(gen, team);
  const anyAssumed = rows.some((r) => r.sources.some((s) => s.assumed));
  return (
    <>
      <p className="muted">
        Best damage multiplier your team can deal to each defending type.
        {anyAssumed && ' Members without damaging moves are counted by their own types (STAB).'}
      </p>
      <div className="coverage-grid">
        {rows.map((r) => {
          const best = r.sources.reduce((a, s) => Math.max(a, s.multiplier), 0);
          const label = r.sources.length
            ? r.sources.map((s) => `${team[s.member].species.name}${s.move ? ` — ${s.move}` : ' (STAB)'}`).join('\n')
            : 'No super effective option';
          return (
            <div key={r.type} className={`cov ${best > 1 ? 'hit' : 'miss'}`} title={label} style={{ borderColor: TYPE_COLORS[r.type] }}>
              <TypeBadge type={r.type} small />
              <b>{best > 1 ? `${r.sources.length}×` : '—'}</b>
              <small className="muted">{best > 1 ? 'SE sources' : 'gap'}</small>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Stats({ team }: { team: Member[] }) {
  const avg = teamAverages(team);
  return (
    <>
      <div className="stat-table">
        <div className="stat-head"><span /> {STATS.map((s) => <b key={s}>{STAT_LABEL[s]}</b>)}<b>BST</b></div>
        {team.map((m, i) => (
          <div key={i} className="stat-row">
            <span className="who"><Sprite name={m.species.name} size={28} types={m.species.types} />{m.species.name}</span>
            {STATS.map((s) => {
              const v = m.species.baseStats[s];
              return <span key={s} className="sv" style={{ background: `hsl(${Math.min(140, v)} 55% 30% / ${0.25 + Math.min(1, v / 150) * 0.6})` }}>{v}</span>;
            })}
            <span className="sv">{memberStats(m).bst}</span>
          </div>
        ))}
        <div className="stat-row avg">
          <span className="who">Team average</span>
          {STATS.map((s) => <span key={s} className="sv">{Math.round(avg[s])}</span>)}
          <span className="sv">{Math.round(STATS.reduce((a, s) => a + avg[s], 0))}</span>
        </div>
      </div>
    </>
  );
}

export function AnalysisPanel({ gen, team }: { gen: Generation; team: Member[] }) {
  const [tab, setTab] = useState<Tab>('defense');
  const notes = insights(gen, team);
  return (
    <section className="panel analysis">
      <div className="tabs">
        {(['defense', 'offense', 'stats'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'defense' ? 'Weaknesses & resistances' : t === 'offense' ? 'Type coverage' : 'Stats'}
          </button>
        ))}
      </div>
      {team.length === 0 ? (
        <p className="muted">Add Pokémon to see the analysis.</p>
      ) : (
        <>
          {tab === 'defense' && <Defense gen={gen} team={team} />}
          {tab === 'offense' && <Offense gen={gen} team={team} />}
          {tab === 'stats' && <Stats team={team} />}
          <div className="insights">
            {notes.map((n, i) => <div key={i} className={`insight ${n.level}`}>{n.level === 'good' ? '✓' : '!'} {n.text}</div>)}
          </div>
        </>
      )}
    </section>
  );
}
