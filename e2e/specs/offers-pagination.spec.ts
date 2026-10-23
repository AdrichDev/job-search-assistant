import { expect, test } from '../support/test.js';
import { GENERATED_AT, HEALTHY_QUEUE, type QueueEntryFile, type QueueFile } from '../fixtures/queue.js';

/**
 * Point 8 of the list: the offers are paginated, ten per page.
 *
 * The page lives in the URL, so a reload keeps it and a link can carry it. The
 * fixture is the healthy queue cloned to twelve postings, which is the smallest
 * number that proves both a full first page and a short second one.
 */

const QUEUE: QueueFile = {
  ...HEALTHY_QUEUE,
  generatedAt: GENERATED_AT,
  jobs: Array.from({ length: 12 }, (_, index) => {
    const base = HEALTHY_QUEUE.jobs[index % HEALTHY_QUEUE.jobs.length] as QueueEntryFile;
    const rank = index + 1;
    return { ...base, id: `offer-${rank}`, rank, title: `Oferta ${rank}` };
  }),
  totalFetched: 12,
  totalUnique: 12,
  totalJuniorEligible: 12,
};

test('the offers are paginated ten per page and the page lives in the URL', async ({
  seed,
  page,
}) => {
  await seed(QUEUE);
  await page.goto('/');

  await expect(page.locator('article')).toHaveCount(10);
  await expect(page.getByText('Página 1 de 2')).toBeVisible();

  await page.getByRole('button', { name: 'Siguiente' }).click();

  await expect(page.locator('article')).toHaveCount(2);
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
});

test('a link can carry the page, and it survives a reload', async ({ seed, page }) => {
  await seed(QUEUE);

  await page.goto('/?pagina=2');
  await expect(page.locator('article')).toHaveCount(2);

  await page.reload();
  await expect(page.locator('article')).toHaveCount(2);
});

test('a page past the end is clamped instead of showing nothing', async ({ seed, page }) => {
  await seed(QUEUE);

  await page.goto('/?pagina=99');
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
});
