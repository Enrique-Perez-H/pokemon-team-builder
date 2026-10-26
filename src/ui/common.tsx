import { useState } from 'react';
import type { ReactNode } from 'react';
import { Dex } from '@pkmn/dex';
import type { TypeName } from '../engine/data';

export const TYPE_COLORS: Record<string, string> = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c',
  Ice: '#96d9d6', Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#a98ff3',
  Psychic: '#f95587', Bug: '#a6b91a', Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc',
  Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad',
};

export function TypeBadge({ type, small }: { type: TypeName | string; small?: boolean }) {
  return (
    <span className={`type-badge${small ? ' small' : ''}`} style={{ background: TYPE_COLORS[type] }}>
      {type}
    </span>
  );
}

const toID = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Showdown sprite ids: base species plus forme, each reduced to letters and digits ("Urshifu-Rapid-Strike" → urshifu-rapidstrike). */
export function spriteId(name: string): string {
  const sp = Dex.species.get(name);
  if (!sp.exists) return toID(name);
  const forme = sp.forme ? `-${toID(sp.forme)}` : '';
  return toID(sp.baseSpecies) + forme;
}

/** Sprite locations to try in order: animated, then the static pixel sprite, then the 3D render. */
export const spriteUrls = (name: string): string[] => {
  const id = spriteId(name);
  const base = 'https://play.pokemonshowdown.com/sprites';
  return [`${base}/ani/${id}.gif`, `${base}/gen5/${id}.png`, `${base}/dex/${id}.png`];
};

export function Sprite({ name, size = 80, types }: { name: string; size?: number; types?: string[] }) {
  const [attempt, setAttempt] = useState(0);
  const [lastName, setLastName] = useState(name);
  // A different Pokémon starts over from the first sprite location.
  if (name !== lastName) {
    setLastName(name);
    setAttempt(0);
  }
  const urls = spriteUrls(name);
  if (attempt >= urls.length) {
    return (
      <div className="sprite-fallback" style={{ width: size, height: size, background: TYPE_COLORS[types?.[0] ?? 'Normal'] }}>
        {name[0]}
      </div>
    );
  }
  return (
    <img
      className="sprite"
      src={urls[attempt]}
      alt={name}
      loading="lazy"
      style={{ maxWidth: size, maxHeight: size }}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TypeFilter({ types, value, onChange }: { types: TypeName[]; value: TypeName[]; onChange: (t: TypeName[]) => void }) {
  const toggle = (t: TypeName) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="chip-row">
      {types.map((t) => (
        <button
          key={t}
          className={`chip${value.includes(t) ? ' on' : ''}`}
          style={value.includes(t) ? { background: TYPE_COLORS[t], borderColor: TYPE_COLORS[t] } : undefined}
          onClick={() => toggle(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
