import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Open the app with sprite requests blocked (they come from a third-party host and are irrelevant to behaviour). */
export async function openApp(page: Page, path = '/') {
  await page.route(/play\.pokemonshowdown\.com/, (route) => route.abort());
  await page.goto(path);
  await expect(page.locator('.nav-tabs')).toBeVisible();
}

/** Pick a Pokémon into the first empty slot through the picker. */
export async function addPokemon(page: Page, name: string) {
  await page.locator('.card.empty').first().click();
  await page.fill('.picker-controls input', name);
  await page.locator('.pick:not(.blocked)').first().click();
}

/** Run the optimizer and apply its first result; waits until the team has moves. */
export async function buildTeam(page: Page) {
  await page.locator('.optimizer .btn.primary').click();
  await expect(page.locator('.opt-result').first()).toBeVisible({ timeout: 45_000 });
  await page.locator('.opt-result').first().locator('button').click();
  await expect(page.locator('.card:not(.empty) .move:not(.add)').first()).toBeVisible({ timeout: 30_000 });
}

export const teamNames = (page: Page) => page.locator('.card:not(.empty) .card-title strong').allTextContents();

/** Set of "Pokémon: move, move" lines for the current team. */
export const teamSets = (page: Page) =>
  page.locator('.card:not(.empty)').evaluateAll((cards) =>
    cards.map((c) => `${c.querySelector('.card-title strong')!.textContent}: ${[...c.querySelectorAll('.move:not(.add) button span')].map((x) => x.textContent).join(', ')}`),
  );

export async function waitForGameData(page: Page) {
  await expect(page.getByText('Loading game data')).toHaveCount(0, { timeout: 20_000 });
}
