import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';

/**
 * UI-4: the offer list's filters live in the URL and the filter bar stays put.
 *
 * The three fixture postings are one per CV variant (frontend, microsoft,
 * general), which is what makes "filtering by variant leaves one card" a real
 * assertion instead of a coincidence.
 */

const CV_LABEL = 'Versión del CV';
const SEARCH_LABEL = 'Buscar por puesto, empresa, ubicación o tecnología';

test('a filtered URL is rendered by the server, not by the browser', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);

  await page.goto('/?cv=frontend');

  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('Junior Frontend Developer');
});

test('an unknown value in the URL shows everything instead of nothing', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);

  await page.goto('/?cv=senior&estado=hired&fuente=milanuncios');

  await expect(page.locator('article')).toHaveCount(3);
});

test('changing a filter writes it to the URL and survives a reload', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await page.goto('/');
  await expect(page.locator('article')).toHaveCount(3);

  // The option values are the variant ids, so selecting by value needs no copy.
  await page.getByLabel(CV_LABEL).selectOption('microsoft');

  await expect(page).toHaveURL(/cv=microsoft/);
  await expect(page.locator('article')).toHaveCount(1);

  await page.reload();

  // A reload is a fresh server render: the filter is in the address bar, so the
  // list comes back filtered instead of resetting.
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.getByLabel(CV_LABEL)).toHaveValue('microsoft');
});

test('the search box is in the URL too, and clearing it cleans the URL', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await page.goto('/');

  await page.getByLabel(SEARCH_LABEL).fill('frontend');
  await expect(page).toHaveURL(/q=frontend/);
  await expect(page.locator('article')).toHaveCount(1);

  await page.getByLabel(SEARCH_LABEL).fill('');
  await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator('article')).toHaveCount(3);
});

test('the filter bar stays visible while the list scrolls', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await page.goto('/');

  const bar = page.getByLabel(CV_LABEL).locator('xpath=ancestor::div[contains(@class,"sticky")][1]');
  await expect(bar).toHaveCount(1);

  const style = await bar.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { position: computed.position, top: computed.top, zIndex: computed.zIndex };
  });
  expect(style.position).toBe('sticky');
  expect(style.top).toBe('0px');
  // Above the cards, or the bar would slide under them.
  expect(Number(style.zIndex)).toBeGreaterThan(0);
});
