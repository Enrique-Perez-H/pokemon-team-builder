import { useEffect, useState } from 'react';
import { ALL_TYPES, genId, hasTera, typesIn } from '../engine/data';
import type { Generation, StatKey } from '../engine/data';
import { autoMoves } from '../engine/moves';
import { NO_BOOSTS, calcDamage, calcReady, loadCalc } from '../engine/calc';
import type { Combatant, DamageResult, FieldOptions, Status, Terrain, Weather } from '../engine/calc';
import { computeStats, hasItems, hasNatures, suggestBuild } from '../engine/sets';
import type { Build } from '../engine/sets';
import { BuildEditor } from './BuildEditor';
import { MovePicker } from './MovePicker';
import { PokemonPicker } from './PokemonPicker';
import { Sprite, TypeBadge } from './common';
import type { Format } from '../engine/roles';
import { buildFor, resolveSlots, TEAM_SIZE } from './state';
import type { Slot } from './state';

interface Side {
  species: string;
  build: Build;
  moves: string[];
  boosts: Record<StatKey, number>;
  status: Status;
  /** '' none, 'build' = the build's Tera type, otherwise a type name. */
  tera: string;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
}

const BOOST_STATS: StatKey[] = ['atk', 'def', 'spa', 'spd', 'spe'];
const STATUSES: { v: Status; label: string }[] = [
  { v: '', label: 'Healthy' }, { v: 'brn', label: 'Burned' }, { v: 'par', label: 'Paralyzed' },
  { v: 'psn', label: 'Poisoned' }, { v: 'tox', label: 'Badly poisoned' }, { v: 'slp', label: 'Asleep' }, { v: 'frz', label: 'Frozen' },
];

const asCombatant = (s: Side): Combatant => ({
  species: s.species, build: s.build, boosts: s.boosts, status: s.status,
  tera: ((s.tera === 'build' ? s.build.tera : s.tera) || undefined) as Combatant['tera'],
});

interface Props {
  gen: Generation;
  slots: (Slot | null)[];
  enemy: string[];
  enemySets?: Record<string, Slot>;
  format: Format;
}

export function CalcTab({ gen, slots, enemy, enemySets, format }: Props) {
  const [att, setAtt] = useState<Side | null>(null);
  const [def, setDef] = useState<Side | null>(null);
  const [weather, setWeather] = useState<Weather>('');
  const [terrain, setTerrain] = useState<Terrain>('');
  const [crit, setCrit] = useState(false);
  const [gameType, setGameType] = useState<'Singles' | 'Doubles'>(format === 'doubles' ? 'Doubles' : 'Singles');
  const [ready, setReady] = useState(calcReady());

  useEffect(() => {
    if (!ready) loadCalc().then(() => setReady(true));
  }, [ready]);

  const members = resolveSlots(gen, slots);

  const fromSlot = (i: number): Side | null => {
    const slot = slots[i];
    const m = members[i];
    if (!slot || !m) return null;
    return {
      species: m.species.name, build: buildFor(gen, slot, m.species, m.moves), moves: slot.moves,
      boosts: NO_BOOSTS(), status: '', tera: '', reflect: false, lightScreen: false, auroraVeil: false,
    };
  };

  /** Any Pokémon outside the team gets a standard build and its best attacking moves. */
  const fromSpecies = async (name: string): Promise<Side | null> => {
    const sp = gen.species.get(name);
    if (!sp) return null;
    // A set read from a screenshot is used as it is.
    const known = enemySets?.[name];
    if (known?.build && known.moves.length) {
      return { species: sp.name, build: { ...known.build, ability: known.ability ?? known.build.ability }, moves: known.moves, boosts: NO_BOOSTS(), status: '', tera: '', reflect: false, lightScreen: false, auroraVeil: false };
    }
    const moves = await autoMoves(gen, sp);
    const mv = moves.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; });
    return { species: sp.name, build: suggestBuild(gen, sp, mv), moves, boosts: NO_BOOSTS(), status: '', tera: '', reflect: false, lightScreen: false, auroraVeil: false };
  };

  // Start with the first team member against the first enemy, when there are any.
  useEffect(() => {
    if (!att) { const first = slots.findIndex(Boolean); if (first >= 0) setAtt(fromSlot(first)); }
    if (!def && enemy[0]) fromSpecies(enemy[0]).then(setDef);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const field = (target: Side): FieldOptions => ({ gameType, weather, terrain, crit, reflect: target.reflect, lightScreen: target.lightScreen, auroraVeil: target.auroraVeil });

  return (
    <div className="calc">
      <div className="panel field-bar">
        <label>Weather
          <select value={weather} onChange={(e) => setWeather(e.target.value as Weather)}>
            <option value="">None</option><option value="Sun">Sun</option><option value="Rain">Rain</option>
            <option value="Sand">Sandstorm</option><option value="Snow">Snow</option><option value="Hail">Hail</option>
          </select>
        </label>
        <label>Terrain
          <select value={terrain} onChange={(e) => setTerrain(e.target.value as Terrain)}>
            <option value="">None</option><option value="Electric">Electric</option><option value="Grassy">Grassy</option>
            <option value="Psychic">Psychic</option><option value="Misty">Misty</option>
          </select>
        </label>
        <label>Battle
          <select value={gameType} onChange={(e) => setGameType(e.target.value as 'Singles' | 'Doubles')} title="Doubles applies the 25% spread-move reduction">
            <option value="Singles">Singles</option><option value="Doubles">Doubles</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} /> Critical hits</label>
        <button className="btn" onClick={() => { const a = att; setAtt(def); setDef(a); }} disabled={!att && !def}>⇄ Swap sides</button>
      </div>

      <div className="calc-grid">
        <SideCard title="Side A" gen={gen} side={att} onChange={setAtt} slots={slots} members={members} enemy={enemy} fromSlot={fromSlot} fromSpecies={fromSpecies} />
        <SideCard title="Side B" gen={gen} side={def} onChange={setDef} slots={slots} members={members} enemy={enemy} fromSlot={fromSlot} fromSpecies={fromSpecies} />
      </div>

      {!ready ? (
        <p className="muted" role="status">Loading the damage calculator…</p>
      ) : att && def ? (
        <div className="calc-grid">
          <Results gen={gen} from={att} to={def} field={field(def)} />
          <Results gen={gen} from={def} to={att} field={field(att)} />
        </div>
      ) : (
        <p className="muted">Choose a Pokémon for both sides to see the damage each one deals.</p>
      )}
    </div>
  );
}

interface SideCardProps {
  title: string;
  gen: Generation;
  side: Side | null;
  onChange: (s: Side | null) => void;
  slots: (Slot | null)[];
  members: ReturnType<typeof resolveSlots>;
  enemy: string[];
  fromSlot: (i: number) => Side | null;
  fromSpecies: (name: string) => Promise<Side | null>;
}

function SideCard({ title, gen, side, onChange, slots, members, enemy, fromSlot, fromSpecies }: SideCardProps) {
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addMove, setAddMove] = useState(false);
  const sp = side ? gen.species.get(side.species) : undefined;

  const choose = async (value: string) => {
    if (value === 'any') return setPicking(true);
    if (value.startsWith('team:')) return onChange(fromSlot(Number(value.slice(5))));
    if (value.startsWith('enemy:')) return onChange(await fromSpecies(enemy[Number(value.slice(6))]));
  };
  const patch = (p: Partial<Side>) => side && onChange({ ...side, ...p });

  const stats = side && sp ? computeStats(gen, sp, side.build) : null;

  return (
    <section className="panel side-card">
      <div className="side-head">
        <h2>{title}</h2>
        <select value="" onChange={(e) => choose(e.target.value)}>
          <option value="">{side ? 'Change Pokémon…' : 'Choose Pokémon…'}</option>
          {slots.some(Boolean) && (
            <optgroup label="My team">
              {slots.map((s, i) => s && members[i] && <option key={i} value={`team:${i}`}>{s.species}</option>)}
            </optgroup>
          )}
          {enemy.length > 0 && (
            <optgroup label="Enemy team">
              {enemy.map((n, i) => <option key={i} value={`enemy:${i}`}>{n}</option>)}
            </optgroup>
          )}
          <option value="any">Any Pokémon…</option>
        </select>
      </div>

      {side && sp && stats && (
        <>
          <div className="side-mon">
            <Sprite name={sp.name} size={72} types={sp.types} />
            <div className="side-info">
              <strong>{sp.name}</strong>
              <div className="badges">{sp.types.map((t) => <TypeBadge key={t} type={t} small />)}</div>
              <small className="muted">
                {hasNatures(gen) ? `${side.build.nature} · ` : ''}Lv {side.build.level}
                {hasItems(gen) && side.build.item ? ` · ${side.build.item}` : ''}{side.build.ability ? ` · ${side.build.ability}` : ''}
              </small>
              <small className="stat-line">
                {(['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as StatKey[]).map((k) => `${k.toUpperCase()} ${stats[k]}`).join(' · ')}
              </small>
            </div>
            <button className="btn" onClick={() => setEditing(true)}>Edit build</button>
          </div>

          <div className="boosts">
            {BOOST_STATS.map((k) => (
              <label key={k}>{k.toUpperCase()}
                <select value={side.boosts[k]} onChange={(e) => patch({ boosts: { ...side.boosts, [k]: Number(e.target.value) } })}>
                  {Array.from({ length: 13 }, (_, i) => 6 - i).map((v) => <option key={v} value={v}>{v > 0 ? `+${v}` : v}</option>)}
                </select>
              </label>
            ))}
            <label>Status
              <select value={side.status} onChange={(e) => patch({ status: e.target.value as Status })}>
                {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
          </div>
          {hasTera(gen) && (
            <label className="tera-select">Terastallized
              <select value={side.tera} onChange={(e) => patch({ tera: e.target.value })}>
                <option value="">No</option>
                {side.build.tera && <option value="build">As built: {side.build.tera}</option>}
                {(typesIn(gen).length ? typesIn(gen) : ALL_TYPES).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <div className="screens">
            <label className="check"><input type="checkbox" checked={side.reflect} onChange={(e) => patch({ reflect: e.target.checked })} /> Reflect</label>
            <label className="check"><input type="checkbox" checked={side.lightScreen} onChange={(e) => patch({ lightScreen: e.target.checked })} /> Light Screen</label>
            <label className="check"><input type="checkbox" checked={side.auroraVeil} onChange={(e) => patch({ auroraVeil: e.target.checked })} /> Aurora Veil</label>
          </div>

          <div className="chip-row">
            {side.moves.map((m) => (
              <span key={m} className="move-chip">{m}<button className="icon-btn tiny" onClick={() => patch({ moves: side.moves.filter((x) => x !== m) })} aria-label={`Remove ${m}`}>✕</button></span>
            ))}
            {side.moves.length < 4 && <button className="chip" onClick={() => setAddMove(true)}>+ Move</button>}
          </div>
        </>
      )}

      {picking && (
        <PokemonPicker
          gen={gen} megas rules={[]} slots={Array(TEAM_SIZE).fill(null)} slot={0} suggestions={[]}
          onPick={async (name) => { setPicking(false); onChange(await fromSpecies(name)); }}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && side && sp && (
        <BuildEditor
          gen={gen} species={sp} build={side.build}
          onChange={(b) => patch({ build: b })}
          onSuggest={() => patch({ build: suggestBuild(gen, sp, side.moves.flatMap((n) => { const m = gen.moves.get(n); return m ? [m] : []; }), side.build.ability) })}
          onClose={() => setEditing(false)}
        />
      )}
      {addMove && side && sp && (
        <MovePicker
          gen={gen} species={sp.name} speciesTypes={sp.types} chosen={side.moves}
          onPick={(m) => { patch({ moves: [...side.moves, m] }); setAddMove(false); }}
          onClose={() => setAddMove(false)}
        />
      )}
    </section>
  );
}

function Results({ gen, from, to, field }: { gen: Generation; from: Side; to: Side; field: FieldOptions }) {
  const [selected, setSelected] = useState<string | null>(null);
  const n = genId(gen);
  const rows = from.moves.map((move) => ({ move, r: calcDamage(n, asCombatant(from), asCombatant(to), move, field) }));
  const strongest = rows.reduce<(typeof rows)[number] | undefined>((a, x) => (!a || x.r.max > a.r.max ? x : a), undefined);
  const sel = rows.find((x) => x.move === selected) ?? strongest;

  return (
    <section className="panel results">
      <h2>{from.species} → {to.species}</h2>
      {rows.length === 0 && <p className="muted">{from.species} has no moves yet. Add some on its card.</p>}
      {rows.map(({ move, r }) => (
        <button key={move} className={`result-row${sel?.move === move ? ' sel' : ''}`} onClick={() => setSelected(move)}>
          <div className="result-top">
            <span className="mv">{move}</span>
            {r.moveType && <TypeBadge type={r.moveType} small />}
            <span className="muted">{r.category && r.category !== 'Status' ? `${r.category} · ${r.power || '—'}` : r.category}</span>
          </div>
          <Damage r={r} />
        </button>
      ))}
      {sel && sel.r.ok && !sel.r.status && sel.r.max > 0 && (
        <div className="detail">
          <p>{sel.r.desc}</p>
          {sel.r.rolls.length > 0 && (
            <small className="muted">Rolls (% of HP): {sel.r.rolls.map((x) => ((x / sel.r.defenderHp) * 100).toFixed(1)).join(', ')}</small>
          )}
        </div>
      )}
    </section>
  );
}

function Damage({ r }: { r: DamageResult }) {
  if (!r.ok) return <div className="dmg err">{r.error}</div>;
  if (r.status) return <div className="dmg muted">Status move</div>;
  if (r.max <= 0) return <div className="dmg muted">No effect</div>;
  return (
    <div className="dmg">
      <div className="dmg-bar">
        <i className="max" style={{ width: `${Math.min(100, r.maxPct)}%` }} />
        <i className="min" style={{ width: `${Math.min(100, r.minPct)}%` }} />
      </div>
      <div className="dmg-text">
        <b>{r.minPct.toFixed(1)}% – {r.maxPct.toFixed(1)}%</b>
        <small className="muted">({r.min}–{r.max} of {r.defenderHp} HP)</small>
        {r.ko && <small className="ko">{r.ko}</small>}
      </div>
    </div>
  );
}
