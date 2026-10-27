import { useEffect, useMemo, useState } from 'react';
import { genId } from '../engine/data';
import type { Generation } from '../engine/data';
import { defenseTable } from '../engine/analysis';
import { bestAnswers, fighterFromMember, matchup, topCounters } from '../engine/counter';
import type { Foe, Matchup } from '../engine/counter';
import { NO_FIELD, bestMove, calcReady, combatant, loadCalc } from '../engine/calc';
import { planBring } from '../engine/doubles';
import type { Format } from '../engine/roles';
import { moveTypesOf } from '../engine/moves';
import { prepareFoes, realMatchup, topCountersReal } from '../engine/realdamage';
import type { FoeSet, RealCounter, RealMatchup } from '../engine/realdamage';
import { computeStats } from '../engine/sets';
import { optimizeVsFoes } from '../engine/search';
import type { VsFoesResult } from '../engine/search';
import type { OptimizedTeam } from '../engine/optimize';
import type { Member } from '../engine/types';
import type { RuleInstance } from '../engine/rules';
import { PokemonPicker } from './PokemonPicker';
import { QuickRules } from './QuickRules';
import { Sprite, TypeBadge } from './common';
import { buildFor, resolveSlots, slotsFromResult, TEAM_SIZE } from './state';
import type { Slot } from './state';

interface Props {
  gen: Generation;
  megas: boolean;
  rules: RuleInstance[];
  slots: (Slot | null)[];
  enemy: string[];
  onEnemy: (names: string[]) => void;
  /** Replace the player's team and switch back to the builder. */
  onApply: (slots: Slot[]) => void;
  onAddToTeam: (species: string) => void;
  onLockAll: (locked: boolean) => void;
  onRules: (rules: RuleInstance[]) => void;
  format: Format;
}

const cellClass = (m: Matchup) =>
  m.score >= 2 ? 'win2' : m.score >= 0.75 ? 'win' : m.score > -0.75 ? 'even' : m.score > -2 ? 'lose' : 'lose2';

const isReal = (m: Matchup | RealMatchup): m is RealMatchup => 'ourPct' in m;

/** Damage as a percentage; anything past a knock-out reads as 100%+. */
const pct = (x: number) => (x >= 100 ? '100%+' : `${Math.round(x)}%`);

const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

export function EnemyTab({ gen, megas, rules, slots, enemy, onEnemy, onApply, onAddToTeam, onLockAll, onRules, format }: Props) {
  const [picking, setPicking] = useState<number | null>(null);
  const [foeSets, setFoeSets] = useState<FoeSet[]>([]);
  const [calcOk, setCalcOk] = useState(calcReady());
  const [real, setReal] = useState(true);
  const [realCounters, setRealCounters] = useState<Record<string, RealCounter[]>>({});
  const [dir, setDir] = useState<'mine' | 'theirs'>('mine');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [applying, setApplying] = useState(false);
  const [run, setRun] = useState<VsFoesResult | null>(null);
  const results = run?.teams ?? null;
  const n = genId(gen);
  const field = { ...NO_FIELD, gameType: format === 'doubles' ? ('Doubles' as const) : ('Singles' as const) };

  const species = useMemo(
    () => enemy.flatMap((name) => { const s = gen.species.get(name); return s ? [s] : []; }),
    [gen, enemy],
  );

  useEffect(() => {
    if (!calcOk) loadCalc().then(() => setCalcOk(true));
  }, [calcOk]);

  // Give each enemy Pokémon a concrete set: its likely attacking moves and a standard competitive build.
  useEffect(() => {
    let live = true;
    prepareFoes(gen, species).then((f) => live && setFoeSets(f));
    return () => { live = false; };
  }, [gen, species]);

  const setFor = (name: string) => foeSets.find((f) => f.species.name === name);
  const foes: Foe[] = species.map((s) => ({ species: s, attackTypes: moveTypesOf(gen, setFor(s.name)?.moves ?? [], s) }));
  const members = resolveSlots(gen, slots);
  const mineInfo = slots.flatMap((slot, i) => (slot && members[i] ? [{ slot, m: members[i] as Member }] : []));
  const foeTypes = foes.map((f) => [...f.species.types]);

  const profile = useMemo(
    () => defenseTable(gen, species.map((s) => ({ species: s, moves: [] }))).filter((r) => r.weak >= 2).sort((a, b) => b.weak - a.weak),
    [gen, species],
  );
  const threatUnion = [...new Set(foes.flatMap((f) => f.attackTypes))];

  // Your team vs the enemy: real damage where your Pokémon have moves, type matchups otherwise.
  const matrix: (Matchup | RealMatchup)[][] = useMemo(
    () => mineInfo.map(({ slot, m }) => {
      const build = buildFor(gen, slot, m.species, m.moves);
      const us = { combatant: combatant(m.species.name, build), moves: slot.moves, speed: computeStats(gen, m.species, build).spe };
      const fighter = fighterFromMember(gen, m);
      return foes.map((f) => {
        const fs = foeSets.find((x) => x.species.name === f.species.name);
        return real && calcOk && fs && slot.moves.length ? realMatchup(n, us, fs, field) : matchup(gen, fighter, f);
      });
    }),
    [gen, slots, foeSets, species, real, calcOk, format], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const answers = matrix.length ? bestAnswers(matrix, foes.length) : [];
  const bring = format === 'doubles' && mineInfo.length >= 2 && foes.length ? planBring(matrix, mineInfo.map((x) => x.m)) : null;

  // Quick type-based counters show immediately; real-damage ones replace them when ready.
  const counters = useMemo(
    () => foes.map((f) => topCounters(gen, rules, f, megas, 6)),
    [gen, rules, megas, foeSets, species], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!real || !foeSets.length) { setRealCounters({}); return; }
    let live = true;
    Promise.all(foeSets.map((f) => topCountersReal(gen, rules, f, megas, 6, 40, field))).then((lists) => {
      if (live) setRealCounters(Object.fromEntries(foeSets.map((f, i) => [f.species.name, lists[i]])));
    });
    return () => { live = false; };
  }, [real, foeSets, rules, megas, gen, format]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real damage: our chosen moves and builds against the enemy's likely moves on standard builds.
  const damage = useMemo(() => {
    if (!foes.length || !calcOk) return null;
    const mineFull = mineInfo.map(({ slot, m }) => ({
      name: m.species.name, moves: slot.moves, c: combatant(m.species.name, buildFor(gen, slot, m.species, m.moves)),
    }));
    const theirs = foes.flatMap((f) => {
      const fs = foeSets.find((x) => x.species.name === f.species.name);
      return fs ? [{ name: f.species.name, moves: fs.moves, c: fs.combatant }] : [];
    });
    const mineVsTheirs = mineFull.map((a) => theirs.map((d) => bestMove(n, a.c, d.c, a.moves, field)));
    const theirsVsMine = theirs.map((a) => mineFull.map((d) => bestMove(n, a.c, d.c, a.moves, field)));
    return { mineFull, theirs, mineVsTheirs, theirsVsMine };
  }, [gen, slots, foeSets, species, calcOk, format]); // eslint-disable-line react-hooks/exhaustive-deps

  const build = async () => {
    setBusy(true);
    setRun(null);
    setProgress(0);
    try {
      const locked = slots.map((s) => (s?.locked ? gen.species.get(s.species) ?? null : null));
      setRun(await optimizeVsFoes({ gen, rules, locked, megas, foes: species, real, format, onProgress: setProgress }));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (team: OptimizedTeam) => {
    setApplying(true);
    onApply(await slotsFromResult(gen, team, slots.map((s) => (s?.locked ? s : null)), foeTypes, format));
    setApplying(false);
  };

  const setSlot = (i: number, name: string | null) => {
    const next = [...enemy];
    if (name === null) next.splice(i, 1);
    else next[i] = name;
    onEnemy(next.slice(0, TEAM_SIZE));
    setRun(null);
  };

  /** For each foe, the member of a result team that handles it best (by real damage when we have it). */
  const resultAnswers = (t: OptimizedTeam) =>
    foes.map((_, e) => {
      const rated = t.slots.map((s, i) => {
        const real = run?.table.get(s.name)?.[e];
        const m = real ?? matchup(gen, fighterFromMember(gen, { species: s, ability: t.abilities[i], moves: [] }), foes[e]);
        return { name: s.name, m };
      }).sort((a, b) => b.m.score - a.m.score)[0];
      return { foe: e, name: rated.name, score: rated.m.score, detail: isReal(rated.m) && rated.m.ourMove ? `${rated.m.ourMove} ${pct(rated.m.ourPct)} · takes ${pct(rated.m.theirPct)}` : '' };
    });

  return (
    <div className="layout enemy-layout">
      <div className="main-col">
        <section className="panel">
          <h2>Enemy team</h2>
          <p className="muted">Enter the opposing Pokémon. Their likely attacks are estimated from their best learnable moves.</p>
          <div className="enemy-grid">
            {Array.from({ length: TEAM_SIZE }, (_, i) => {
              const f = foes[i];
              return f ? (
                <div key={i} className="enemy-card">
                  <button className="sprite-btn small" onClick={() => setPicking(i)} title="Change">
                    <Sprite name={f.species.name} size={56} types={f.species.types} />
                  </button>
                  <div className="enemy-info">
                    <strong>{f.species.name}</strong>
                    <div className="badges">{f.species.types.map((t) => <TypeBadge key={t} type={t} small />)}</div>
                    <small className="muted">Attacks with: {f.attackTypes.join(', ')}</small>
                  </div>
                  <button className="icon-btn" onClick={() => setSlot(i, null)} aria-label="Remove">✕</button>
                </div>
              ) : (
                <button key={i} className="enemy-card empty" onClick={() => setPicking(enemy.length)}>+ Add enemy Pokémon</button>
              );
            })}
          </div>
          {foes.length > 0 && (
            <div className="enemy-profile">
              <div>
                <b>Their shared weaknesses</b>
                <div className="chip-row">
                  {profile.length ? profile.map((r) => (
                    <span key={r.type} className="tagged"><TypeBadge type={r.type} small /> ×{r.weak}</span>
                  )) : <span className="muted">None shared by two or more</span>}
                </div>
              </div>
              <div>
                <b>Types they threaten you with</b>
                <div className="chip-row">{threatUnion.map((t) => <TypeBadge key={t} type={t} small />)}</div>
              </div>
            </div>
          )}
        </section>

        {foes.length > 0 && (
          <section className="panel">
            <h2>Your current team vs. the enemy</h2>
            {mineInfo.length > 0 && <p className="muted">{real ? 'Scored from real damage for Pokémon that have moves; hover a cell for the numbers.' : 'Scored from types and speed.'}</p>}
            {!mineInfo.length ? (
              <p className="muted">Add Pokémon on the Team builder tab to see how they match up, or build a counter team below.</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="matrix versus">
                    <thead>
                      <tr>
                        <th />
                        {foes.map((f) => <th key={f.species.name} title={f.species.name}><Sprite name={f.species.name} size={36} types={f.species.types} /></th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {mineInfo.map(({ m }, i) => (
                        <tr key={i}>
                          <td className="who"><Sprite name={m.species.name} size={30} types={m.species.types} />{m.species.name}</td>
                          {matrix[i].map((mm, j) => (
                            <td key={j} className={`cell ${cellClass(mm)}`} title={isReal(mm) && mm.ourMove ? `${mm.ourMove} ≈ ${pct(mm.ourPct)} of their HP; their ${mm.theirMove ?? 'best move'} ≈ ${pct(mm.theirPct)} of yours · Speed ${fmt(mm.speed)}` : `Offense ${fmt(mm.off)} · Defense ${fmt(mm.def)} · Speed ${fmt(mm.speed)}`}>{fmt(mm.score)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="insights">
                  {answers.map((a) => {
                    const foe = foes[a.foe].species.name;
                    const who = mineInfo[a.member]?.m.species.name;
                    return a.score >= 0.75 ? (
                      <div key={a.foe} className="insight good">✓ {foe}: answered by {who} ({fmt(a.score)})</div>
                    ) : (
                      <div key={a.foe} className={`insight ${a.score > -0.75 ? 'warn' : 'bad'}`}>! {foe}: no good answer — best is {who} ({fmt(a.score)})</div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {bring && (
          <section className="panel bring">
            <h2>Doubles: who to bring</h2>
            <p className="muted">
              Four of your six are brought. These answer the enemy team best, based on the matchup table above
              ({format === 'doubles' ? 'spread-move damage included' : ''}).
            </p>
            <div className="bring-row">
              {bring.bring.map((i) => {
                const lead = bring.leads.includes(i);
                const m = mineInfo[i].m;
                return (
                  <div key={i} className={`bring-mon${lead ? ' lead' : ''}`}>
                    <Sprite name={m.species.name} size={48} types={m.species.types} />
                    <strong>{m.species.name}</strong>
                    <small className="muted">{lead ? 'Lead' : 'Back'}</small>
                  </div>
                );
              })}
            </div>
            {bring.uncovered.length > 0 ? (
              <div className="insight warn">! Not well handled by these four: {bring.uncovered.map((e) => foes[e].species.name).join(', ')}.</div>
            ) : (
              <div className="insight good">✓ Every enemy Pokémon has a good answer among the four.</div>
            )}
            {mineInfo.length > 4 && (
              <small className="muted">Left at home: {mineInfo.filter((_, i) => !bring.bring.includes(i)).map((x) => x.m.species.name).join(', ')}.</small>
            )}
          </section>
        )}

        {damage && damage.mineFull.length > 0 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Damage check</h2>
              <div className="seg">
                <button className={dir === 'mine' ? 'on' : ''} onClick={() => setDir('mine')}>Your attacks</button>
                <button className={dir === 'theirs' ? 'on' : ''} onClick={() => setDir('theirs')}>Their attacks</button>
              </div>
            </div>
            <p className="muted">
              Best move by real damage, as % of the target's HP.
              {dir === 'mine' ? ' Uses your moves and builds against standard builds of the enemy.' : " Uses each enemy's likely moves and a standard build against your builds."}
            </p>
            <div className="table-wrap">
              <table className="matrix versus">
                <thead>
                  <tr>
                    <th />
                    {(dir === 'mine' ? damage.theirs : damage.mineFull).map((x) => <th key={x.name} title={x.name}><Sprite name={x.name} size={36} /></th>)}
                  </tr>
                </thead>
                <tbody>
                  {(dir === 'mine' ? damage.mineFull : damage.theirs).map((row, i) => (
                    <tr key={row.name}>
                      <td className="who"><Sprite name={row.name} size={30} />{row.name}</td>
                      {(dir === 'mine' ? damage.mineVsTheirs[i] : damage.theirsVsMine[i]).map((b, j) => (
                        <DamageCell key={j} best={b} mine={dir === 'mine'} empty={!row.moves.length} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {foes.length > 0 && (
          <section className="panel">
            <h2>Best individual counters</h2>
            <p className="muted">Highest-rated matchups among Pokémon your rules allow{real ? ', judged by real damage (their best move on each side)' : ''}. Click one to add it to your team.</p>
            {foes.map((f, i) => (
              <div key={f.species.name + i} className="counter-row">
                <div className="counter-foe"><Sprite name={f.species.name} size={40} types={f.species.types} /><b>vs {f.species.name}</b></div>
                <div className="counter-list">
                  {(real && realCounters[f.species.name]
                    ? realCounters[f.species.name].map((c) => ({
                        species: c.species, score: c.matchup.score,
                        detail: `${c.matchup.ourMove ?? '—'} ${pct(c.matchup.ourPct)} · takes ${pct(c.matchup.theirPct)}`,
                      }))
                    : (counters[i] ?? []).map((c) => ({ species: c.species, score: c.matchup.score, detail: `Offense ${fmt(c.matchup.off)} · Defense ${fmt(c.matchup.def)}` }))
                  ).map((c) => (
                    <button key={c.species.name} className="suggest" onClick={() => onAddToTeam(c.species.name)} title={c.detail}>
                      <Sprite name={c.species.name} size={40} types={c.species.types} />
                      <div><strong>{c.species.name}</strong><small>{fmt(c.score)} · {c.detail}</small></div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>

      <aside className="side-col">
        <section className="panel optimizer">
          <h2>Counter team</h2>
          <p className="muted">Builds the team of six that best answers every enemy Pokémon while staying well rounded, using your rules.</p>
          <QuickRules rules={rules} onChange={onRules} label="Which Pokémon can be used?" />
          <div className="opt-actions">
            <div className="lock-line">
              <small className="muted">
                {slots.some((x) => x?.locked) ? `${slots.filter((x) => x?.locked).length} locked 🔒 Pokémon will be kept.` : 'Lock 🔒 Pokémon on the builder tab to keep them.'}
              </small>
              {slots.some(Boolean) && (
                <span>
                  <button className="chip" onClick={() => onLockAll(true)}>Lock all</button>{' '}
                  <button className="chip" onClick={() => onLockAll(false)}>Unlock all</button>
                </span>
              )}
            </div>
            <label className="check" title="Runs the damage calculator for the most promising Pokémon against each enemy. Slower, more accurate.">
              <input type="checkbox" checked={real} onChange={(e) => { setReal(e.target.checked); setRun(null); }} />
              Judge by real damage (recommended)
            </label>
            <button className="btn primary" disabled={!foes.length || busy || applying} onClick={build}>
              {busy ? (real ? `Calculating damage… ${Math.round(progress * 100)}%` : 'Searching…') : foes.length ? 'Build counter team' : 'Add enemy Pokémon first'}
            </button>
          </div>
          {results && results.length === 0 && <p className="insight bad">No team satisfies these rules. Try relaxing one.</p>}
          {results && results.length > 0 && (
            <div className="opt-results">
              {results.map((r, i) => {
                const ans = resultAnswers(r);
                return (
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
                    <div className="answers">
                      {ans.map((a) => (
                        <small key={a.foe} className={a.score >= 0.75 ? 'good' : 'bad'}>
                          {foes[a.foe].species.name} → {a.name} ({fmt(a.score)}){a.detail ? ` · ${a.detail}` : ''}
                        </small>
                      ))}
                    </div>
                    <button className="btn primary" disabled={applying} onClick={() => apply(r)}>Use this team</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </aside>

      {picking !== null && (
        <PokemonPicker
          gen={gen}
          megas={megas}
          rules={[]}
          slots={Array(TEAM_SIZE).fill(null)}
          slot={picking}
          suggestions={[]}
          onPick={(name) => { setSlot(picking, name); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

function DamageCell({ best, mine, empty }: { best: ReturnType<typeof bestMove>; mine: boolean; empty: boolean }) {
  if (!best) return <td className="cell even" title={empty ? 'No moves chosen' : 'No damaging move'}>{empty ? 'no moves' : '—'}</td>;
  const { result: r, move } = best;
  // Green when it is our damage that is high, red when it is theirs.
  const level = r.maxPct >= 100 ? 3 : r.maxPct >= 50 ? 2 : r.maxPct >= 25 ? 1 : 0;
  const cls = level === 0 ? 'even' : mine ? ['', 'win', 'win', 'win2'][level] : ['', 'lose', 'lose', 'lose2'][level];
  return (
    <td className={`cell ${cls}`} title={`${move}: ${r.desc}${r.ko ? ` — ${r.ko}` : ''}`}>
      {Math.round(r.minPct)}–{Math.round(r.maxPct)}%
      <small className="cell-move">{move}</small>
    </td>
  );
}
