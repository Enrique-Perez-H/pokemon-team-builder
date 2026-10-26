import { STATS, STAT_LABEL, abilitiesOf } from '../engine/data';
import type { Generation, Specie, StatKey } from '../engine/data';
import { MAX_EV_TOTAL, computeStats, evTotal, hasItems, hasNatures, itemList, natureLabel, natureList, normalizeEvs } from '../engine/sets';
import type { Build } from '../engine/sets';
import { Modal } from './common';

interface Props {
  gen: Generation;
  species: Specie;
  build: Build;
  onChange: (b: Build) => void;
  onSuggest: () => void;
  onClose: () => void;
}

export function BuildEditor({ gen, species, build, onChange, onSuggest, onClose }: Props) {
  const natures = natureList(gen);
  const items = itemList(gen);
  const abilities = abilitiesOf(gen, species);
  const stats = computeStats(gen, species, build);
  const nature = natures.find((n) => n.name === build.nature);
  const old = gen.num < 3;
  const total = evTotal(build.evs);

  const setEv = (k: StatKey, v: number) => onChange({ ...build, evs: normalizeEvs({ ...build.evs, [k]: v }, k) });
  const setIv = (k: StatKey, v: number) => onChange({ ...build, ivs: { ...build.ivs, [k]: Math.max(0, Math.min(31, v || 0)) } });
  const mark = (k: StatKey) => (nature?.plus === k ? ' ▲' : nature?.minus === k ? ' ▼' : '');

  return (
    <Modal title={`${species.name} — build`} onClose={onClose}>
      <div className="build-top">
        <label>Level
          <input type="number" min={1} max={100} value={build.level} onChange={(e) => onChange({ ...build, level: Math.max(1, Math.min(100, Number(e.target.value) || 100)) })} />
        </label>
        {hasNatures(gen) && (
          <label>Nature
            <select value={build.nature} onChange={(e) => onChange({ ...build, nature: e.target.value })}>
              {natures.map((n) => <option key={n.name} value={n.name}>{natureLabel(n)}</option>)}
            </select>
          </label>
        )}
        {abilities.length > 0 && (
          <label>Ability
            <select value={build.ability ?? ''} onChange={(e) => onChange({ ...build, ability: e.target.value || undefined })}>
              <option value="">Default</option>
              {abilities.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}
        {hasItems(gen) && (
          <label>Item
            <select value={build.item ?? ''} onChange={(e) => onChange({ ...build, item: e.target.value || undefined })}>
              <option value="">None</option>
              {items.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </label>
        )}
      </div>

      {old ? (
        <p className="muted">Generations 1–2 use maximum stat experience and perfect DVs, so only the level matters.</p>
      ) : (
        <p className={`muted${total > MAX_EV_TOTAL ? ' bad-text' : ''}`}>EVs used: {total} / {MAX_EV_TOTAL} ({MAX_EV_TOTAL - total} left)</p>
      )}

      <table className="build-table">
        <thead>
          <tr><th /><th>Base</th>{!old && <><th>IV</th><th colSpan={2}>EV</th></>}<th>Stat</th></tr>
        </thead>
        <tbody>
          {STATS.map((k) => (
            <tr key={k}>
              <td>{STAT_LABEL[k]}<span className="nat">{mark(k)}</span></td>
              <td className="muted">{species.baseStats[k]}</td>
              {!old && (
                <>
                  <td><input type="number" min={0} max={31} value={build.ivs[k]} onChange={(e) => setIv(k, Number(e.target.value))} /></td>
                  <td className="ev-slider"><input type="range" min={0} max={252} step={4} value={build.evs[k]} onChange={(e) => setEv(k, Number(e.target.value))} /></td>
                  <td><input type="number" min={0} max={252} step={4} value={build.evs[k]} onChange={(e) => setEv(k, Number(e.target.value))} /></td>
                </>
              )}
              <td><b>{stats[k]}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="build-actions">
        <button className="btn" onClick={onSuggest}>Suggest a build</button>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
