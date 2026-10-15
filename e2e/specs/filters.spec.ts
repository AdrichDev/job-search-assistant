import { applyLinkFor, expect, test } from '../support/test.js';
import { HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';

/**
 * Filtering, and the honesty of the numbers next to it.
 *
 * The second half is the interesting one. A filtered list with a headline that
 * still claims the unfiltered total is the same class of defect as the dead
 * apply button: the interface stating something it cannot back up. So every
 * assertion here pairs "what is visible" with "what the page says is visible".
 */

test.describe('filters and counts', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('the queue heading counts the offers actually rendered', async ({ page }) => {
    const total = HEALTHY_QUEUE.jobs.length;

    await expect(page.getByRole('heading', { name: `${total} ofertas` })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(total);
    await expect(page.getByText(`Mostrando ${total} de ${total} ofertas`)).toBeVisible();
  });

  test('searching narrows the list and the counter stays truthful', async ({ page }) => {
    await page.getByLabel('Buscar por puesto, empresa, ubicación o tecnología').fill('Kubo');

    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText(`Mostrando 1 de ${HEALTHY_QUEUE.jobs.length} ofertas`)).toBeVisible();
    await expect(page.getByRole('heading', { name: HEALTHY_TITLES[1] as string })).toBeVisible();

    // The total is the size of the queue, NOT of the filtered view. Showing the
    // filtered count as the total would misreport how many offers exist.
    await expect(
      page.getByRole('heading', { name: `${HEALTHY_QUEUE.jobs.length} ofertas` }),
    ).toBeVisible();
  });

  test('filtering by CV variant selects the matching offers only', async ({ page }) => {
    await page.getByLabel('Versión del CV').selectOption('microsoft');

    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: HEALTHY_TITLES[1] as string })).toBeVisible();
    await expect(page.getByText('Mostrando 1 de 3 ofertas')).toBeVisible();
  });

  test('the applied filter reflects a real application made in this browser', async ({ page }) => {
    const applied = HEALTHY_TITLES[2] as string;

    await applyLinkFor(page, applied).click();
    await expect(applyLinkFor(page, applied)).toContainText('Aplicada', { timeout: 15_000 });

    await page.getByLabel('Estado de la postulación').selectOption('applied');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: applied })).toBeVisible();

    await page.getByLabel('Estado de la postulación').selectOption('not_applied');
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: applied })).toHaveCount(0);
  });

  test('a filter that matches nothing says so instead of showing a blank page', async ({
    page,
  }) => {
    await page.getByLabel('Buscar por puesto, empresa, ubicación o tecnología').fill('cobol');

    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('Ninguna oferta coincide con estos filtros.')).toBeVisible();
    await expect(
      page.getByText('Prueba a borrar el texto de búsqueda o a poner los filtros en «Todas».'),
    ).toBeVisible();
    await expect(page.getByText('Mostrando 0 de 3 ofertas')).toBeVisible();
  });
});
