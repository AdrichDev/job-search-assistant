import { expect, test } from '../support/test.js';
import { DEGRADED_QUEUE, EMPTY_QUEUE } from '../fixtures/queue.js';

/**
 * The two ways the page can be empty, which are not the same fact.
 *
 * This distinction is the whole reason the state exists. The app was once left
 * showing nothing at all after every source query returned HTTP 429, and a
 * blank screen turns a recoverable API outage into "the tool is broken" for the
 * person relying on it to find work.
 *
 * So: "we asked and the market had nothing" and "we could not ask" must render
 * different words. A test that only asserted "the list is empty" would pass
 * with both messages swapped, which is why each assertion here names the other
 * message and requires it to be ABSENT.
 */

test.describe('empty and degraded states', () => {
  test('a healthy run with no matches explains that the filters found nothing', async ({
    page,
    seed,
  }) => {
    await seed(EMPTY_QUEUE);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'La cola está vacía' })).toBeVisible();
    await expect(
      page.getByText('ninguna oferta pasó los dos filtros', { exact: false }),
    ).toBeVisible();

    // Not an outage. The alarm belongs to the other state.
    await expect(
      page.getByRole('heading', { name: 'La última ejecución no obtuvo ofertas' }),
    ).toHaveCount(0);
    await expect(page.getByText('Ejecución degradada')).toHaveCount(0);

    // Filters would be furniture with nothing to filter.
    await expect(page.getByLabel('Versión del CV')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '0 ofertas' })).toBeVisible();
  });

  test('a failed run says the sources failed and that nothing was overwritten', async ({
    page,
    seed,
  }) => {
    await seed(DEGRADED_QUEUE);
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'La última ejecución no obtuvo ofertas' }),
    ).toBeVisible();

    // The reassurance the user actually needs: their data is still there.
    await expect(
      page.getByText('Tus datos anteriores no se han sobrescrito.', { exact: false }),
    ).toBeVisible();

    // The failure is named, with its real cause, not hidden behind "error".
    await expect(page.getByText('1 consulta de origen falló en esta ejecución')).toBeVisible();
    await expect(page.getByText('HTTP 429 Too Many Requests', { exact: false })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'La cola está vacía' })).toHaveCount(0);
  });

  test('no persisted run at all falls back to sample data and says the links are not real', async ({
    page,
    seed,
  }) => {
    await seed(null);
    await page.goto('/');

    /*
     * The offline catalogue is invented data whose URLs point at
     * `example-board.test`. Rendering it silently would be shipping the exact
     * defect this suite exists for - a screen of plausible offers with dead
     * buttons - so the banner is mandatory, not cosmetic.
     */
    await expect(
      page.getByRole('heading', { name: 'Ofertas para ti' }),
    ).toBeVisible();
    await expect(page.getByText('Datos de ejemplo, no ofertas reales')).toBeVisible();
    await expect(
      page.getByText('Los enlaces no llevan a ofertas reales.', { exact: false }),
    ).toBeVisible();
  });
});
