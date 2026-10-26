import { useEffect, useMemo, useState } from 'react';
import { genId } from '../engine/data';
import type { Generation, TypeName } from '../engine/data';
import { defenseTable } from '../engine/analysis';
import { bestAnswers, counterObjective, fighterFromMember, matchupMatrix, topCounters } from '../engine/counter';
import type { Foe, Matchup } from '../engine/counter';
import { likelyAttackTypes } from '../engine/moves';
import { optimizeTeam } from '../engine/optimize';
import type { OptimizedTeam } from '../engine/optimize';
import type { Member } from '../engine/types';
import type { RuleInstance } from '../engine/rules';
import { PokemonPicker } from './PokemonPicker';
import { Sprite, TypeBadge } from './common';
import { resolveSlots, slotsFromResult, TEAM_SIZE } from './state';
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
}

const cellClass = (m: Matchup) =>
  m.score >= 2 ? 'win2' : m.score >= 0.75 ? 'win' : m.score > -0.75 ? 'even' : m.score > -2 ? 'lose' : 'lose2';

const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));

export function EnemyTab({ gen, megas, rules, slots, enemy, onEnemy, onApply, onAddToTeam }: Props) {
  const [picking, setPicking] = useState<number | null>(null);
  const [threats, setThreats] = useState<Record<string, TypeName[]>>({});
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<OptimizedTeam[] | null>(null);

  const species = useMemo(
    () => enemy.flatMap((n) => { const s = gen.species.get(n); return s ? [s] : []; }),
    [gen, enemy],
  );

  // Estimate what each enemy Pokémon will attack with (its best learnable attacking moves).
  useEffect(() => {
    let live = true;
    species.forEach((s) => {
      const key = `${genId(gen)}:${s.name}`;
      if (threats[key]) return;
      likelyAttackTypes(gen, s).then((t) => live && setThreats((cur) => ({ ...cur, [key]: t })));
    });
    return () => { live = false; };
  }, [gen, species]); // eslint-disable-line react-hooks/exhaustive-deps

  const foes: Foe[] = species.map((s) => ({ species: s, attackTypes: threats[`${genId(gen)}:${s.name}`] ?? [...s.types] }));
  const mine = resolveSlots(gen, slots).filter((m): m is Member => !!m);
  const foeTypes = foes.map((f) => [...f.species.types]);

  const profile = useMemo(
    () => defenseTable(gen, species.map((s) => ({ species: s, moves: [] }))).filter((r) => r.weak >= 2).sort((a, b) => b.weak - a.weak),
    [gen, species],
  );
  const threatUnion = [...new Set(foes.flatMap((f) => f.attackTypes))];

  const matrix = mine.length && foes.length ? matchupMatrix(gen, mine.map((m) => fighterFromMember(gen, m)), foes) : [];
  const answers = matrix.length ? bestAnswers(matrix, foes.length) : [];

  const counters = useMemo(
    () => foes.map((f) => topCounters(gen, rules, f, megas, 6)),
    [gen, rules, megas, species, threats], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const build = () => {
    setBusy(true);
    setResults(null);
    setTimeout(() => {
      const locked = (keep ? slots : slots.map(() => null)).map((s) => (s ? gen.species.get(s.species) ?? null : null));
      const { objective, rank } = counterObjective(gen, foes);
      setResults(optimizeTeam({ gen, rules, locked, megas, objective, rank }));
      setBusy(false);
    }, 30);
  };

  const apply = async (team: OptimizedTeam) => {
    setApplying(true);
    onApply(await slotsFromResult(gen, team, keep ? slots : slots.map(() => null), foeTypes));
    setApplying(false);
  };

  const setSlot = (i: number, name: string | null) => {
    const next = [...enemy];
    if (name === null) next.splice(i, 1);
    else next[i] = name;
    onEnemy(next.slice(0, TEAM_SIZE));
    setResults(null);
  };

  const resultAnswers = (t: OptimizedTeam) => {
    const fighters = t.slots.map((s, i) => fighterFromMember(gen, { species: s, ability: t.abilities[i], moves: [] }));
    return bestAnswers(matchupMatrix(gen, fighters, foes), foes.length).map((a) => ({ ...a, name: t.slots[a.member]?.name ?? '—' }));
  };

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
            {!mine.length ? (
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
                      {mine.map((m, i) => (
                        <tr key={i}>
                          <td className="who"><Sprite name={m.species.name} size={30} types={m.species.types} />{m.species.name}</td>
                          {matrix[i].map((mm, j) => (
                            <td key={j} className={`cell ${cellClass(mm)}`} title={`Offense ${fmt(mm.off)} · Defense ${fmt(mm.def)} · Speed ${fmt(mm.speed)}`}>{fmt(mm.score)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="insights">
                  {answers.map((a) => {
                    const foe = foes[a.foe].species.name;
                    const who = mine[a.member]?.species.name;
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

        {foes.length > 0 && (
          <section className="panel">
            <h2>Best individual counters</h2>
            <p className="muted">Highest-rated matchups among Pokémon your rules allow. Click one to add it to your team.</p>
            {foes.map((f, i) => (
              <div key={f.species.name + i} className="counter-row">
                <div className="counter-foe"><Sprite name={f.species.name} size={40} types={f.species.types} /><b>vs {f.species.name}</b></div>
                <div className="counter-list">
                  {counters[i]?.map((c) => (
                    <button key={c.species.name} className="suggest" onClick={() => onAddToTeam(c.species.name)} title={`Offense ${fmt(c.matchup.off)} · Defense ${fmt(c.matchup.def)} · Speed ${fmt(c.matchup.speed)}`}>
                      <Sprite name={c.species.name} size={40} types={c.species.types} />
                      <div><strong>{c.species.name}</strong><small>{fmt(c.matchup.score)}</small></div>
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
          <div className="opt-actions">
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Keep the {slots.filter(Boolean).length} Pokémon already on my team
            </label>
            <button className="btn primary" disabled={!foes.length || busy || applying} onClick={build}>
              {busy ? 'Searching…' : foes.length ? 'Build counter team' : 'Add enemy Pokémon first'}
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
                          {foes[a.foe].species.name} → {a.name} ({fmt(a.score)})
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
