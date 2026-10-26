import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { addPokemon, buildTeam, openApp } from './helpers';

/** What spills past the right edge of the screen (ignoring anything inside a horizontally scrolling box). */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scrolls = (el: Element) => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    const wide: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && !scrolls(el)) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
    }
    return { doc: document.documentElement.scrollWidth - vw, wide: [...new Set(wide)] };
  });
}

/** Buttons and fields too small to tap, and form text small enough to make iOS zoom in. */
async function touchProblems(page: Page) {
  return page.evaluate(() => {
    const small: string[] = [];
    const zoom: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, select, input:not([type=checkbox]):not([type=range]), textarea')) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === 'none' || !r.width || el.closest('.stat')) continue;
      if (el.tagName !== 'TEXTAREA' && (r.height < 30 || r.width < 30)) small.push(`${el.tagName.toLowerCase()}.${el.className.split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (el.tagName !== 'BUTTON' && parseFloat(cs.fontSize) < 16) zoom.push(`${el.tagName.toLowerCase()}.${el.className.split(' ')[0]} ${cs.fontSize}`);
    }
    return { small: [...new Set(small)], zoom: [...new Set(zoom)] };
  });
}

async function expectComfortable(page: Page, where: string) {
  const o = await overflow(page);
  expect(o.doc, `${where}: page is wider than the screen`).toBeLessThanOrEqual(0);
  expect(o.wide, `${where}: elements past the right edge`).toEqual([]);
  const t = await touchProblems(page);
  expect(t.small, `${where}: touch targets under 30px`).toEqual([]);
  expect(t.zoom, `${where}: form text under 16px`).toEqual([]);
}

test.describe('on a phone', () => {
  test('the builder fits the screen and the optimizer is reachable', async ({ page }) => {
    await openApp(page);
    await page.locator('.quick', { hasText: 'No legendaries' }).tap();
    // The header must not cover the screen (it used to be sticky and over 300px tall).
    const header = await page.locator('.topbar').evaluate((el) => ({ pos: getComputedStyle(el).position, h: el.getBoundingClientRect().height }));
    expect(header.pos).not.toBe('sticky');
    await buildTeam(page); // taps the optimizer button, which sits just below the team
    await expectComfortable(page, 'builder');
    // tools come right after the team, before the long analysis
    const order = await page.evaluate(() => {
      const y = (s: string) => document.querySelector(s)!.getBoundingClientRect().top + window.scrollY;
      return { team: y('.team-grid'), opt: y('.optimizer'), analysis: y('.analysis') };
    });
    expect(order.team).toBeLessThan(order.opt);
    expect(order.opt).toBeLessThan(order.analysis);
  });

  test('modals are usable bottom sheets', async ({ page }) => {
    await openApp(page);
    await addPokemon(page, 'Garchomp');
    await page.locator('.build-summary').first().tap();
    await expectComfortable(page, 'build editor');
    const box = await page.locator('.modal').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(380);
    await page.locator('.modal-head .icon-btn').tap();
    await page.locator('.card .sprite-btn').first().tap();
    await expectComfortable(page, 'Pokémon picker');
    await page.locator('.modal-head .icon-btn').tap();
    await page.locator('.btn', { hasText: 'Import / export' }).tap();
    await expectComfortable(page, 'import / export');
  });

  test('the bottom tab bar switches between the three tools', async ({ page }) => {
    await openApp(page);
    await addPokemon(page, 'Garchomp');
    const nav = page.locator('.nav-tabs');
    expect((await nav.evaluate((el) => getComputedStyle(el).position))).toBe('fixed');
    await nav.getByRole('button', { name: /enemy team/ }).tap();
    await expect(page.locator('.enemy-grid')).toBeVisible();
    await expectComfortable(page, 'enemy tab');
    await nav.getByRole('button', { name: /calculator/ }).tap();
    await expect(page.locator('.field-bar')).toBeVisible();
    await expectComfortable(page, 'calculator');
    await nav.getByRole('button', { name: /Team builder/ }).tap();
    await expect(page.locator('.team-grid')).toBeVisible();
  });
});
