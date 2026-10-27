import { expect, test } from '@playwright/test';
import { addPokemon, buildTeam, openApp, teamNames, teamSets, waitForGameData } from './helpers';

test.describe('team builder', () => {
  test('adds a Pokémon, picks a move and shows real stats', async ({ page }) => {
    await openApp(page);
    await addPokemon(page, 'Garchomp');
    await expect(page.locator('.card-title strong')).toHaveText('Garchomp');
    // real stats at level 100 for the suggested build, not base stats
    await expect(page.locator('.card .stat b').first()).not.toHaveText('108');
    await page.locator('.card .move.add').first().click();
    await page.fill('.picker-controls input', 'Earthquake');
    await page.locator('.move-table tbody tr').first().click();
    await expect(page.locator('.card .move:not(.add)').first()).toContainText('Earthquake');
    await page.locator('.tabs button', { hasText: 'Type coverage' }).click();
    await expect(page.locator('.coverage-grid')).toBeVisible();
  });

  test('rules hide banned Pokémon and flag violations', async ({ page }) => {
    await openApp(page);
    await page.locator('.optimizer .quick', { hasText: 'No legendaries' }).click();
    await page.locator('.optimizer .quick', { hasText: 'No Paradox' }).click();
    await page.locator('.card.empty').first().click();
    await page.fill('.picker-controls input', 'Mewtwo');
    await expect(page.locator('.pick:not(.blocked)')).toHaveCount(0);
    await page.fill('.picker-controls input', 'Flutter Mane');
    await expect(page.locator('.pick:not(.blocked)')).toHaveCount(0);
    await page.fill('.picker-controls input', 'Garchomp');
    await expect(page.locator('.pick:not(.blocked)')).toHaveCount(1);
    await page.locator('.modal-head .icon-btn').click();
    // Banning a type flags a team member that has it
    await addPokemon(page, 'Garchomp');
    await page.selectOption('.add-rule', 'banned_types');
    await page.locator('.rule', { hasText: 'Banned types' }).locator('.chip', { hasText: 'Flying' }).click(); // turn the default off
    await page.locator('.rule', { hasText: 'Banned types' }).locator('.chip', { hasText: 'Ground' }).click();
    await expect(page.locator('.issue')).toContainText('Ground type is banned');
  });

  test('"No legendaries" is offered right beside the build button and excludes them', async ({ page }) => {
    await openApp(page);
    const chip = page.locator('.optimizer .quick', { hasText: 'No legendaries' });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // it is the same rule the Rules panel shows
    await expect(page.locator('.rule strong', { hasText: 'No legendaries' })).toBeVisible();
    await buildTeam(page);
    const legendary = ['Mewtwo', 'Zacian', 'Zamazenta', 'Miraidon', 'Koraidon', 'Eternatus', 'Arceus', 'Kyogre', 'Groudon', 'Rayquaza', 'Lugia', 'Ho-Oh', 'Mew', 'Lunala', 'Solgaleo'];
    const names = await teamNames(page);
    expect(names.filter((n) => legendary.some((l) => n.startsWith(l)))).toEqual([]);
    await expect(page.locator('.issue')).toHaveCount(0);
    await chip.click(); // and it can be turned off again
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.rule strong', { hasText: 'No legendaries' })).toHaveCount(0);
  });

  test('the optimizer builds a legal team with full sets and covered roles', async ({ page }) => {
    await openApp(page);
    await page.locator('.optimizer .quick', { hasText: 'No legendaries' }).click();
    await page.locator('.optimizer .quick', { hasText: 'No Paradox' }).click();
    await buildTeam(page);
    await expect(page.locator('.card:not(.empty)')).toHaveCount(6);
    await expect(page.locator('.issue')).toHaveCount(0);
    const sets = await teamSets(page);
    for (const line of sets) expect(line.split(': ')[1].split(', ').length).toBeGreaterThanOrEqual(3);
    await page.locator('.tabs button', { hasText: 'Roles' }).click();
    await expect(page.locator('.role-row.has').first()).toBeVisible();
    await expect(page.locator('.report .tile', { hasText: 'Roles' })).toContainText('/6');
  });

  test('locked Pokémon survive a rebuild', async ({ page }) => {
    await openApp(page);
    await buildTeam(page);
    const first = (await teamNames(page))[0];
    await page.locator('.lock').first().click();
    await buildTeam(page);
    expect((await teamNames(page))[0]).toBe(first);
  });

  test('reordering with the arrow buttons swaps slots', async ({ page }) => {
    await openApp(page);
    await addPokemon(page, 'Garchomp');
    await addPokemon(page, 'Gengar');
    await page.locator('.card').first().locator('.shift .icon-btn').nth(1).click();
    expect(await teamNames(page)).toEqual(['Gengar', 'Garchomp']);
  });

  test('theme toggle is remembered', async ({ page }) => {
    await openApp(page);
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.getByRole('button', { name: 'Toggle light or dark theme' }).click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await page.reload();
    await expect(page.locator('.nav-tabs')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });
});

test.describe('games', () => {
  test('a game limits the Pokédex and the moves', async ({ page }) => {
    await openApp(page);
    await page.selectOption('.controls select', 'game:red-blue');
    await waitForGameData(page);
    await expect(page.locator('.rule strong').first()).toHaveText('Only Pokémon in Red / Blue');
    await expect(page.locator('.controls input[type=checkbox]')).toBeDisabled(); // no Megas in Gen 1
    await page.locator('.card.empty').first().click();
    await expect(page.locator('.count').first()).toHaveText('151 Pokémon');
    await page.fill('.picker-controls input', 'Chikorita');
    await expect(page.locator('.pick:not(.blocked)')).toHaveCount(0);
    await page.fill('.picker-controls input', 'Pikachu');
    await page.locator('.pick:not(.blocked)').first().click();
    await page.locator('.card .move.add').first().click();
    await expect(page.locator('.move-table tbody tr').first()).toBeVisible(); // the learnset loads asynchronously
    const moves = await page.locator('.move-table tbody tr td:first-child').allInnerTexts();
    expect(moves.some((m) => m.startsWith('Thunderbolt'))).toBe(true);
    expect(moves.some((m) => m.startsWith('Volt Tackle'))).toBe(false); // Gen 3 move
  });

  test('presets keep the game rule and the optimizer stays inside the game', async ({ page }) => {
    await openApp(page);
    await page.selectOption('.controls select', 'game:emerald');
    await waitForGameData(page);
    await page.selectOption('.preset-select', 'balanced');
    await expect(page.locator('.rule strong').first()).toHaveText('Only Pokémon in Emerald');
    await buildTeam(page);
    await expect(page.locator('.issue')).toHaveCount(0);
  });
});

test.describe('team tools', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Showdown export, import and the share link round-trip', async ({ page, context }) => {
    await openApp(page);
    await buildTeam(page);
    const names = await teamNames(page);
    await page.locator('.btn', { hasText: 'Import / export' }).click();
    const exported = await page.locator('.io-grid textarea').first().inputValue();
    for (const n of names) expect(exported).toContain(n);
    expect(exported).toMatch(/Nature/);
    await page.locator('.modal-head .icon-btn').click();

    await page.locator('.btn', { hasText: 'Share link' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const other = await context.newPage();
    await other.route(/play\.pokemonshowdown\.com/, (r) => r.abort());
    await other.goto(link);
    await expect(other.locator('.card:not(.empty)')).toHaveCount(names.length);
    expect(await other.locator('.card:not(.empty) .card-title strong').allTextContents()).toEqual(names);

    await page.locator('.btn', { hasText: 'New team' }).click();
    await expect(page.locator('.card:not(.empty)')).toHaveCount(0);
    await page.locator('.btn', { hasText: 'Import / export' }).click();
    await page.locator('.io-grid textarea').nth(1).fill(exported);
    await page.locator('.io-grid .btn.primary').click();
    await expect.poll(() => teamNames(page)).toEqual(names);
  });

  test('import reports unknown moves but keeps the rest', async ({ page }) => {
    await openApp(page);
    await page.locator('.btn', { hasText: 'Import / export' }).click();
    await page.locator('.io-grid textarea').nth(1).fill('Gengar @ Choice Specs\nAbility: Cursed Body\nTimid Nature\n- Shadow Ball\n- Not A Real Move');
    await page.locator('.io-grid .btn.primary').click();
    await expect(page.locator('.io-grid .issue')).toContainText('Not A Real Move');
    await page.locator('.modal-head .icon-btn').click();
    expect(await teamNames(page)).toEqual(['Gengar']);
    await expect(page.locator('.build-summary').first()).toContainText('Choice Specs');
  });

  test('saved teams survive a reload', async ({ page }) => {
    await openApp(page);
    await addPokemon(page, 'Garchomp');
    await page.locator('.team-name').fill('E2E team');
    await page.locator('.btn', { hasText: 'My teams' }).click();
    await page.locator('.save-row .btn.primary').click();
    await page.locator('.modal-head .icon-btn').click();
    await page.locator('.btn', { hasText: 'New team' }).click();
    await page.reload();
    await expect(page.locator('.nav-tabs')).toBeVisible();
    await page.locator('.btn', { hasText: 'My teams' }).click();
    await expect(page.locator('.saved-info strong')).toHaveText(['E2E team']);
    await page.locator('.saved-team .btn', { hasText: 'Load' }).click();
    expect(await teamNames(page)).toEqual(['Garchomp']);
  });
});

test.describe('damage calculator', () => {
  test('calculates both directions and reacts to the field', async ({ page }) => {
    await openApp(page);
    await addPokemon(page, 'Garchomp');
    await page.locator('.card .move.add').first().click();
    await page.fill('.picker-controls input', 'Outrage');
    await page.locator('.move-table tbody tr').first().click();
    await page.locator('.nav-tabs button', { hasText: 'Damage calculator' }).click();
    await expect(page.locator('.side-card')).toHaveCount(2);
    await page.locator('.side-card').nth(1).locator('select').first().selectOption('any');
    await page.fill('.picker-controls input', 'Skarmory');
    await page.locator('.pick:not(.blocked)').first().click();
    const row = page.locator('.results').first().locator('.result-row').first();
    await expect(row.locator('.dmg-text b')).toBeVisible();
    const before = await row.locator('.dmg-text b').innerText();
    await page.locator('.field-bar label', { hasText: 'Critical hits' }).locator('input').check();
    await expect(row.locator('.dmg-text b')).not.toHaveText(before);
    await expect(page.locator('.results').first().locator('.detail p')).toContainText('Outrage');
  });
});

test.describe('enemy team', () => {
  test('builds a counter team and shows real-damage counters', async ({ page }) => {
    await openApp(page);
    await page.locator('.optimizer .quick', { hasText: 'No legendaries' }).click();
    await page.locator('.nav-tabs button', { hasText: 'Counter an enemy team' }).click();
    // the same toggles are offered next to the counter-team button, and reflect the rule chosen above
    await expect(page.locator('.optimizer .quick', { hasText: 'No legendaries' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.optimizer .quick', { hasText: 'No Paradox' }).click();
    for (const n of ['Charizard', 'Garchomp', 'Gyarados']) {
      await page.locator('.enemy-card.empty').first().click();
      await page.fill('.picker-controls input', n);
      await page.locator('.pick:not(.blocked)').first().click();
    }
    await expect(page.locator('.counter-row .suggest small').first()).toContainText('takes');
    await page.locator('.optimizer .btn.primary').click();
    const result = page.locator('.opt-result').first();
    await expect(result).toBeVisible({ timeout: 45_000 });
    await expect(result.locator('.answers small')).toHaveCount(3);
    await result.locator('button').click();
    await expect(page.locator('.card:not(.empty)')).toHaveCount(6, { timeout: 30_000 });
  });
});

test.describe('Gen 9 features', () => {
  test('Tera types are chosen, shown and can be applied to the defence matrix', async ({ page }) => {
    await openApp(page);
    await buildTeam(page);
    await expect(page.locator('.build-summary').first()).toContainText('Tera');
    await page.locator('.tabs button', { hasText: 'Weaknesses' }).click();
    const before = await page.locator('.matrix tbody .cell').allInnerTexts();
    await page.locator('.tera-toggle input').check();
    expect(await page.locator('.matrix tbody .cell').allInnerTexts()).not.toEqual(before);
    await page.selectOption('.controls select', 'gen:8'); // Terastallization does not exist before Gen 9
    await expect(page.locator('.build-summary', { hasText: 'Tera' })).toHaveCount(0);
    await expect(page.getByText('Suggest Tera types')).toHaveCount(0);
  });

  test('doubles builds Protect sets and recommends who to bring', async ({ page }) => {
    await openApp(page);
    await buildTeam(page);
    await page.locator('.seg button', { hasText: 'Doubles' }).click();
    await page.locator('.btn', { hasText: 'Rebuild all moves' }).click();
    await expect.poll(async () => (await teamSets(page)).filter((s) => s.includes('Protect') || s.includes('Detect') || s.includes('Spiky') || s.includes('King')).length).toBeGreaterThanOrEqual(3);
    await page.locator('.nav-tabs button', { hasText: 'Counter an enemy team' }).click();
    for (const n of ['Incineroar', 'Amoonguss', 'Garchomp']) {
      await page.locator('.enemy-card.empty').first().click();
      await page.fill('.picker-controls input', n);
      await page.locator('.pick:not(.blocked)').first().click();
    }
    await expect(page.locator('.bring .bring-mon')).toHaveCount(4, { timeout: 30_000 });
    await expect(page.locator('.bring .bring-mon.lead')).toHaveCount(2);
  });
});
