import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test.describe('gym leaders and the Elite Four', () => {
  test('loads a trainer as the enemy team with their real moves', async ({ page }) => {
    await openApp(page);
    await page.locator('.nav-tabs button', { hasText: 'Counter an enemy team' }).click();
    await page.getByRole('button', { name: /Load a trainer/ }).click();
    await page.getByLabel('Game', { exact: true }).selectOption('red-blue');
    await expect(page.getByRole('heading', { name: 'Gym Leaders' })).toBeVisible();
    await page.getByRole('button', { name: /^Brock/ }).click();
    await expect(page.locator('.enemy-card:not(.empty)')).toHaveCount(2);
    await expect(page.locator('.enemy-card', { hasText: 'Onix' })).toBeVisible();
    await expect(page.locator('.enemy-layout')).toContainText('Bide');
  });

  test('older games switch the builder to every generation when needed, and every game has teams', async ({ page }) => {
    await openApp(page);
    await page.locator('.nav-tabs button', { hasText: 'Counter an enemy team' }).click();
    await page.getByRole('button', { name: /Load a trainer/ }).click();
    const games = await page.getByLabel('Game', { exact: true }).locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    for (const id of games.filter((g) => !g.startsWith('legends'))) {
      await page.getByLabel('Game', { exact: true }).selectOption(id);
      await expect(page.locator('.trainer-card').first()).toBeVisible();
    }
    await page.getByLabel('Game', { exact: true }).selectOption('scarlet-violet');
    await page.getByRole('button', { name: /^Geeta/ }).click();
    await expect(page.locator('.enemy-card:not(.empty)')).toHaveCount(6);
  });

  test('Radical Red has Pokémon up to Gen 9 and its own gym leaders and Elite Four', async ({ page }) => {
    await openApp(page);
    await page.locator('.controls select').selectOption('game:radical-red');
    await page.locator('.card.empty').first().click();
    await page.fill('.picker-controls input', 'Great Tusk');
    await expect(page.locator('.pick:not(.blocked) strong').first()).toHaveText(/^Great Tusk/);
    await page.getByRole('button', { name: 'Close' }).first().click();
    await page.locator('.nav-tabs button', { hasText: 'Counter an enemy team' }).click();
    await page.getByRole('button', { name: /Load a trainer/ }).click();
    await expect(page.getByLabel('Game', { exact: true })).toHaveValue('radical-red');
    await page.getByRole('button', { name: /^Brock, Pewter City/ }).click();
    await expect(page.locator('.enemy-card:not(.empty)')).toHaveCount(4);
    await expect(page.locator('.enemy-card', { hasText: 'Geodude-Alola' })).toBeVisible();
  });
});
