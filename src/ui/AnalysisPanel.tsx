import { useState } from 'react';
import { STATS, STAT_LABEL } from '../engine/data';
import type { Generation, StatKey } from '../engine/data';
import { coverageTable, defenseTable, insights, memberStats, teamAverages, teamReport } from '../engine/analysis';
import type { Member } from '../engine/types';
import { coreRoles, expectedRoles, rolesFor, teamRoles } from '../engine/roles';
import type { Format } from '../engine/roles';
import { Sprite, TypeBadge, TYPE_COLORS } from './common';

type Tab = 'defense' | 'offense' | 'roles' | 'stats';

function multLabel(m: number) {
  return m === 0 ? '0' : m === 0.25 ? '¼' : m === 0.5 ? '½' : m === 1 ? '' : String(m);
}

function multClass(m: number) {
  return m === 0 ? 'm0' : m < 1 ? 'mres' : m === 1 ? 'mneu' : m === 2 ? 'mweak' : 'mweak2';
}

function Defense({ gen, team }: { gen: Generation; team: Member[] }) {
  const [tera, setTera] = useState(false);
  const anyTera = team.some((m) => m.tera);
  const rows = defenseTable(gen, team, tera && anyTera);
  return (
    <div className="table-wrap">
      {anyTera && (
        <label className="check tera-toggle">
          <input type="checkbox" checked={tera} onChange={(e) => setTera(e.target.checked)} />
          Show Terastallized typing (members with a Tera type)
        </label>
      )}
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

function Roles({ team, format }: { team: Member[]; format: Format }) {
  const roles = teamRoles(team);
  const anyMoves = team.some((m) => m.moves.length);
  if (!anyMoves) return <p className="muted">Choose moves for your Pokémon (or use “Fill empty moves” on the builder) to see which support jobs your team covers.</p>;
  return (
    <div className="roles">
      {rolesFor(format).map((r) => {
        const holders = roles[r.id];
        const expected = expectedRoles(format).includes(r.id);
        return (
          <div key={r.id} className={`role-row${holders.length ? ' has' : expected ? ' missing' : ''}`}>
            <div className="role-name">
              <b>{r.label}</b>
              <small className="muted">{r.description}</small>
            </div>
            <div className="role-holders">
              {holders.length ? holders.map((h) => (
                <span key={h.member} className="holder" title={h.moves.join(', ')}>
                  <Sprite name={h.name} size={26} />
                  <span>{h.name}<small className="muted"> {h.moves.join(', ')}</small></span>
                </span>
              )) : <span className={expected ? 'bad-text' : 'muted'}>{expected ? 'Missing' : '—'}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stats({ team, real }: { team: Member[]; real?: Record<StatKey, number>[] }) {
  const base = teamAverages(team);
  const shown = (m: Member, i: number, k: StatKey) => (real?.[i] ? real[i][k] : m.species.baseStats[k]);
  const avg = (k: StatKey) => team.reduce((a, m, i) => a + shown(m, i, k), 0) / team.length;
  const max = (k: StatKey) => Math.max(1, ...team.map((m, i) => shown(m, i, k)));
  const order = team.map((m, i) => ({ m, speed: shown(m, i, 'spe') })).sort((a, b) => b.speed - a.speed);
  const fastest = order[0]?.speed || 1;
  return (
    <>
      <p className="muted">{real ? 'Real stats from each Pokémon’s level, nature, EVs and IVs.' : 'Base stats.'} Colours compare members within each stat.</p>
      <div className="stat-table">
        <div className="stat-head"><span /> {STATS.map((s) => <b key={s}>{STAT_LABEL[s]}</b>)}<b>{real ? 'Total' : 'BST'}</b></div>
        {team.map((m, i) => (
          <div key={i} className="stat-row">
            <span className="who"><Sprite name={m.species.name} size={28} types={m.species.types} />{m.species.name}</span>
            {STATS.map((s) => {
              const v = shown(m, i, s);
              const t = v / max(s);
              return <span key={s} className="sv" style={{ background: `hsl(${Math.round(t * 130)} 55% 30% / ${0.25 + t * 0.55})` }}>{v}</span>;
            })}
            <span className="sv">{STATS.reduce((a, s) => a + shown(m, i, s), 0)}</span>
          </div>
        ))}
        <div className="stat-row avg">
          <span className="who">Team average</span>
          {STATS.map((s) => <span key={s} className="sv">{Math.round(real ? avg(s) : base[s])}</span>)}
          <span className="sv">{Math.round(STATS.reduce((a, s) => a + (real ? avg(s) : base[s]), 0))}</span>
        </div>
      </div>
      <h3 className="sub">Speed order</h3>
      <div className="speed-list">
        {order.map(({ m, speed }, i) => (
          <div key={i} className="speed-row">
            <span className="who"><Sprite name={m.species.name} size={24} types={m.species.types} />{m.species.name}</span>
            <div className="bar"><i style={{ width: `${(speed / fastest) * 100}%`, background: 'var(--accent)' }} /></div>
            <b>{speed}</b>
          </div>
        ))}
      </div>
      <small className="muted">Per-member role: {team.map((m) => `${m.species.name} — ${memberStats(m).role}`).join(' · ')}</small>
    </>
  );
}

function Report({ gen, team, format }: { gen: Generation; team: Member[]; format: Format }) {
  const r = teamReport(gen, team);
  const tile = (label: string, value: string, sub: string, level: 'good' | 'warn' | 'bad') => (
    <div className={`tile ${level}`}>
      <small className="muted">{label}</small>
      <b>{value}</b>
      <small className="muted">{sub}</small>
    </div>
  );
  const roles = teamRoles(team);
  const core = coreRoles(format);
  const covered = core.filter((c) => roles[c].length > 0).length;
  const anyMoves = team.some((m) => m.moves.length);
  const rolesTile = anyMoves
    ? { value: `${covered}/${core.length}`, sub: 'support jobs covered', level: (covered >= 5 ? 'good' : covered >= 3 ? 'warn' : 'bad') as 'good' | 'warn' | 'bad' }
    : { value: '—', sub: 'choose moves to see roles', level: 'warn' as const };
  const lvl = (x: number, n: number) => (x >= n * 0.85 ? 'good' : x >= n * 0.65 ? 'warn' : 'bad') as 'good' | 'warn' | 'bad';
  return (
    <div className="report">
      {tile('Defense', `${r.defenseSafe}/${r.typeCount}`, 'types you handle', lvl(r.defenseSafe, r.typeCount))}
      {tile('Offense', `${r.offenseHit}/${r.typeCount}`, 'types you hit super effectively', lvl(r.offenseHit, r.typeCount))}
      {tile('Speed', `${r.fast}`, `fast members · avg base ${r.avgSpeed}`, team.length >= 4 && r.fast === 0 ? 'bad' : r.fast >= 2 ? 'good' : 'warn')}
      {tile('Roles', rolesTile.value, rolesTile.sub, rolesTile.level)}
      {tile('Balance', `${r.physical}P / ${r.special}S`, `${r.mixed} mixed`, team.length >= 4 && (r.physical === 0 || r.special === 0) ? 'warn' : 'good')}
      {r.sharedWeak.length > 0 && (
        <div className="tile wide">
          <small className="muted">Weaknesses your team does not cover</small>
          <div className="chip-row">
            {r.sharedWeak.slice(0, 6).map((w) => (
              <span key={w.type} className="tagged"><TypeBadge type={w.type} small /> {w.weak} weak · {w.cover} resist</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalysisPanel({ gen, team, real, format = 'singles' }: { gen: Generation; team: Member[]; real?: Record<StatKey, number>[]; format?: Format }) {
  const [tab, setTab] = useState<Tab>('defense');
  const notes = insights(gen, team, format);
  return (
    <section className="panel analysis">
      <div className="tabs">
        {(['defense', 'offense', 'roles', 'stats'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'defense' ? 'Weaknesses & resistances' : t === 'offense' ? 'Type coverage' : t === 'roles' ? 'Roles' : 'Stats'}
          </button>
        ))}
      </div>
      {team.length === 0 ? (
        <p className="muted">Add Pokémon to see the analysis.</p>
      ) : (
        <>
          <Report gen={gen} team={team} format={format} />
          {tab === 'defense' && <Defense gen={gen} team={team} />}
          {tab === 'offense' && <Offense gen={gen} team={team} />}
          {tab === 'roles' && <Roles team={team} format={format} />}
          {tab === 'stats' && <Stats team={team} real={real} />}
          <div className="insights">
            {notes.map((n, i) => <div key={i} className={`insight ${n.level}`}>{n.level === 'good' ? '✓' : '!'} {n.text}</div>)}
          </div>
        </>
      )}
    </section>
  );
}
