import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectTrainers, clean } from '../../scripts/trainer-parser.mjs';
import { getGen } from './data';
import { GAME_BY_ID } from './games';
import { trainerSlots } from './trainers';
import type { Trainer } from './trainers';

const WIKI = `
{{Party
| background = {{rock color}}
| name = {{color2|000|Brock}}
| location = Pewter Gym
| game = RGB
| pokemon = 2
}}
{{Pokémon
| gen = 1
| pokemon = Geodude
| level = 12
| move1 = Tackle | move1type = Normal
| move2 = Defense Curl | move2type = Normal
}}
{{Pokémon
| gen = 1
| pokemon = Onix
| level = 14
| move1 = Bide | move1type = Normal
}}
{{Party/end}}
{{Party
| name = Brock
| location = Pewter Gym
| class = Gym Leader
| game = SV
}}
{{Pokémon
| pokemon = Oricorio
| form = -Pom-Pom
| level = 12/14
| ability = Dancer
| held = Oran Berry
| tera = Flying
| move1 = Revelation&nbsp;Dance
}}
{{Party/end}}
{{Party
| name = Brock
| location = Battle Tower
| game = SV
}}
{{Pokémon
| pokemon = Onix
}}
{{Party/end}}`;

describe('trainer parser', () => {
  it('cleans wiki markup', () => {
    expect(clean('{{color2|000|Brock}}')).toBe('Brock');
    expect(clean('[[Lt. Surge|Surge]]')).toBe('Surge');
  });

  it('reads teams per game and skips battle facilities', () => {
    const per = collectTrainers(WIKI, 'gym');
    expect(per['red-blue']).toHaveLength(1);
    expect(per['red-blue'][0]).toMatchObject({ name: 'Brock', role: 'Gym Leader', location: 'Pewter Gym' });
    expect((per['red-blue'][0].team as { species: string; level: number; moves: string[] }[]).map((m) => m.species)).toEqual(['Geodude', 'Onix']);
    expect(per['scarlet-violet']).toHaveLength(1);
    const mon = (per['scarlet-violet'][0].team as Record<string, unknown>[])[0];
    expect(mon).toMatchObject({ species: 'Oricorio', form: '-Pom-Pom', level: 12, ability: 'Dancer', item: 'Oran Berry', tera: 'Flying', moves: ['Revelation Dance'] });
  });
});

const dir = 'public/data/trainers';
describe.runIf(existsSync(dir))('built trainer data', () => {
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    const id = f.replace('.json', '');
    it(`${id}: every trainer's team loads in that game`, () => {
      const list = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as Trainer[];
      const gen = getGen(GAME_BY_ID[id].gen, id);
      expect(list.length).toBeGreaterThan(10);
      expect(list.some((t) => t.role === 'Gym Leader' || t.role === 'Kahuna')).toBe(true);
      let total = 0, skipped = 0;
      for (const t of list) {
        const r = trainerSlots(gen, t);
        total += t.team.length; skipped += r.skipped.length;
        for (const s of r.slots) {
          expect(s.build!.level).toBeGreaterThan(0);
          expect(s.moves.length).toBeLessThanOrEqual(4);
        }
      }
      expect(skipped / total).toBeLessThan(0.03);
    });
  }
});
