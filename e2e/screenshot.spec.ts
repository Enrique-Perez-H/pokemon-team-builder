import { expect, test } from '@playwright/test';
import { openApp, teamNames } from './helpers';

// Playwright runs from the repository root.
const TEAM_IMAGE = 'e2e/fixtures/gym-leader-team.png';
const FILE_INPUT = 'input[aria-label="Team screenshot"]';
const NAMES = ['Swellow', 'Accelgor', 'Greninja', 'Drapion', 'Iron Valiant', 'Toxtricity'];

/** Reading takes a few seconds the first time (the text reader is downloaded), so allow for it. */
async function readImage(page: import('@playwright/test').Page, file: string | { name: string; mimeType: string; buffer: Buffer } = TEAM_IMAGE) {
  await page.setInputFiles(FILE_INPUT, file);
}

test.describe('team screenshots', () => {
  test('loads a team from a picture, switching to every generation when needed', async ({ page }) => {
    await openApp(page); // starts on "Any Pokémon up to generation 9", which lacks Swellow, Accelgor and Drapion
    await page.getByRole('button', { name: /From screenshot/ }).click();
    await readImage(page);
    await expect(page.locator('.review-row')).toHaveCount(6, { timeout: 90_000 });
    expect(await page.locator('.review-row .review-title strong').allTextContents()).toEqual(NAMES);

    const text = (await page.locator('.review-list').innerText()).replace(/\s+/g, ' ');
    for (const move of ['Hydro Pump', 'Water Shuriken', 'Close Combat', 'Boomburst', 'Cross Poison']) expect(text).toContain(move);
    for (const bit of ['Timid', 'Adamant', 'Choice Specs', 'Choice Scarf', 'Booster Energy', 'Quark Drive']) expect(text).toContain(bit);
    // the made-up Mega is explained, not silently swapped
    expect(text).toMatch(/Toxtricity-Mega.*not in the data/);
    // older Pokémon are flagged with an offer to widen the game
    await expect(page.locator('.insight', { hasText: 'not in the selected game or generation' })).toContainText('Swellow');

    await page.getByRole('button', { name: /Load 6 into my team/ }).click();
    await expect(page.locator('.card:not(.empty)')).toHaveCount(6);
    expect(await teamNames(page)).toEqual(NAMES);
    await expect(page.locator('.controls select')).toHaveValue('all');
    await expect(page.locator('.issue')).toHaveCount(0);
    // moves and builds came from the picture
    await expect(page.locator('.card', { hasText: 'Greninja' })).toContainText('Water Shuriken');
    await expect(page.locator('.card', { hasText: 'Iron Valiant' }).locator('.build-summary')).toContainText('Booster Energy');
  });

  test('the review can be corrected before loading', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: /From screenshot/ }).click();
    await readImage(page);
    await expect(page.locator('.review-row')).toHaveCount(6, { timeout: 90_000 });

    // leave one out, set a level, drop a move
    await page.locator('.review-row', { hasText: 'Drapion' }).locator('input[type=checkbox]').uncheck();
    await page.getByLabel('Greninja level').fill('50');
    await page.getByRole('button', { name: 'Remove Ice Beam' }).click();
    await expect(page.getByRole('button', { name: /Load 5 into my team/ })).toBeVisible();
    await page.getByRole('button', { name: /Load 5 into my team/ }).click();

    expect(await teamNames(page)).toEqual(NAMES.filter((n) => n !== 'Drapion'));
    const greninja = page.locator('.card', { hasText: 'Greninja' });
    await expect(greninja).not.toContainText('Ice Beam');
    // the level typed in the review is the one in the build editor
    await greninja.locator('.build-summary').click();
    await expect(page.locator('.build-top label', { hasText: 'Level' }).locator('input')).toHaveValue('50');
  });

  test('loads the enemy team with its known sets and counters it', async ({ page }) => {
    await openApp(page);
    await page.locator('.nav-tabs button', { hasText: 'Counter an enemy team' }).click();
    await page.getByRole('button', { name: /Load from screenshot/ }).click();
    await readImage(page);
    await expect(page.locator('.review-row')).toHaveCount(6, { timeout: 90_000 });
    await page.getByRole('button', { name: /Use 6 as the enemy team/ }).click();

    await expect(page.locator('.enemy-card:not(.empty)')).toHaveCount(6);
    // each enemy now shows the moves read from the picture rather than guessed attack types
    await expect(page.locator('.enemy-card', { hasText: 'Greninja' })).toContainText('Known set: Hydro Pump');
    await expect(page.locator('.enemy-card', { hasText: 'Iron Valiant' })).toContainText('Close Combat');
    // and the counters are worked out against those real sets
    await expect(page.locator('.counter-row .suggest small').first()).toContainText('takes', { timeout: 40_000 });
    await page.locator('.optimizer .btn.primary').click();
    await expect(page.locator('.opt-result').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.opt-result').first().locator('.answers small')).toHaveCount(6);
  });

  test('says what went wrong for files that are not team pictures', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: /From screenshot/ }).click();
    await readImage(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert')).toContainText('not a picture');
    // a valid image with no text in it
    const blank = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await readImage(page, { name: 'blank.png', mimeType: 'image/png', buffer: blank });
    await expect(page.getByRole('alert')).toContainText(/No (text|Pokémon names)/, { timeout: 60_000 });
    // and the dialog stays usable: closing it leaves the team untouched
    await page.locator('.modal-head .icon-btn').click();
    await expect(page.locator('.card:not(.empty)')).toHaveCount(0);
  });
});
