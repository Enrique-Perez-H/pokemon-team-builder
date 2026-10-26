import { STATS, ALL_TYPES, hasTera } from './data';
import type { Generation, StatKey } from './data';
import { hasItems, hasNatures, perfectIvs, zeroEvs } from './sets';
import type { Build } from './sets';
import type { Slot } from './team';

const LABEL: Record<StatKey, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const BY_NAME: Record<string, StatKey> = {
  hp: 'hp', atk: 'atk', attack: 'atk', def: 'def', defense: 'def', spa: 'spa', spatk: 'spa', spc: 'spa',
  spd: 'spd', spdef: 'spd', spe: 'spe', spd_: 'spd', speed: 'spe',
};

/** Export in the Pokémon Showdown text format, understood by Showdown, the damage calcs and most team tools. */
export function exportTeam(gen: Generation, slots: (Slot | null)[], buildOf: (slot: Slot) => Build): string {
  return slots
    .filter((s): s is Slot => !!s)
    .map((slot) => {
      const b = buildOf(slot);
      const lines: string[] = [];
      lines.push(`${slot.species}${hasItems(gen) && b.item ? ` @ ${b.item}` : ''}`);
      const ability = slot.ability ?? b.ability;
      if (ability && gen.num >= 3) lines.push(`Ability: ${ability}`);
      if (b.level !== 100) lines.push(`Level: ${b.level}`);
      if (b.tera && hasTera(gen)) lines.push(`Tera Type: ${b.tera}`);
      if (gen.num >= 3) {
        const evs = STATS.filter((k) => b.evs[k] > 0).map((k) => `${b.evs[k]} ${LABEL[k]}`);
        if (evs.length) lines.push(`EVs: ${evs.join(' / ')}`);
        if (hasNatures(gen)) lines.push(`${b.nature} Nature`);
        const ivs = STATS.filter((k) => b.ivs[k] !== 31).map((k) => `${b.ivs[k]} ${LABEL[k]}`);
        if (ivs.length) lines.push(`IVs: ${ivs.join(' / ')}`);
      }
      for (const m of slot.moves) lines.push(`- ${m}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export interface ImportResult {
  slots: Slot[];
  warnings: string[];
}

const parseStats = (text: string, into: Record<StatKey, number>) => {
  for (const part of text.split('/')) {
    const m = part.trim().match(/^(\d+)\s+([A-Za-z.]+)$/);
    const key = m && BY_NAME[m[2].toLowerCase().replace('.', '')];
    if (m && key) into[key] = Number(m[1]);
  }
};

/** Parse a Showdown-format team (up to 6 Pokémon). Unknown names are skipped and reported in `warnings`. */
export function importTeam(gen: Generation, text: string): ImportResult {
  const warnings: string[] = [];
  const slots: Slot[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  for (const block of blocks) {
    if (slots.length >= 6) { warnings.push('Only the first 6 Pokémon were imported.'); break; }
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let [head, item] = lines[0].split(' @ ').map((x) => x.trim());
    head = head.replace(/\s*\((M|F)\)\s*$/, '');
    const nick = head.match(/^.+\(([^()]+)\)$/);
    const speciesName = nick ? nick[1] : head;
    const species = gen.species.get(speciesName);
    if (!species) { warnings.push(`Unknown Pokémon in this game: ${speciesName}`); continue; }

    const build: Build = { level: 100, nature: 'Hardy', evs: zeroEvs(), ivs: perfectIvs() };
    const moves: string[] = [];
    let ability: string | undefined;

    for (const line of lines.slice(1)) {
      if (line.startsWith('- ')) {
        const name = line.slice(2).trim().replace(/^Hidden Power \[(\w+)\]$/, 'Hidden Power');
        if (gen.moves.get(name)) { if (moves.length < 4) moves.push(gen.moves.get(name)!.name); }
        else warnings.push(`${species.name}: unknown move ${name}`);
      } else if (/^ability:/i.test(line)) ability = line.slice(line.indexOf(':') + 1).trim();
      else if (/^level:/i.test(line)) build.level = Math.max(1, Math.min(100, Number(line.split(':')[1]) || 100));
      else if (/^tera type:/i.test(line)) {
        const t = ALL_TYPES.find((x) => x.toLowerCase() === line.slice(line.indexOf(':') + 1).trim().toLowerCase());
        if (t && hasTera(gen)) build.tera = t;
      }
      else if (/^evs:/i.test(line)) parseStats(line.slice(4), build.evs);
      else if (/^ivs:/i.test(line)) parseStats(line.slice(4), build.ivs);
      else if (/nature$/i.test(line)) {
        const n = gen.natures.get(line.replace(/nature$/i, '').trim());
        if (n) build.nature = n.name;
      }
    }

    if (item && hasItems(gen)) {
      const it = gen.items.get(item);
      if (it) build.item = it.name;
      else warnings.push(`${species.name}: unknown item ${item}`);
    }
    if (!hasNatures(gen)) build.nature = 'Hardy';
    build.ability = ability;
    slots.push({ species: species.name, ability, moves, build });
  }
  return { slots, warnings };
}
