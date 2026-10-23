import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { seedApplications } from '../support/workspace.js';

/**
 * The analysis view (S9): "Los resultados de tus postulaciones, Version del
 * cv, fuente etc tiene que ir en otra vista, tambien quiero que en funcion de
 * los datos se generen diagramas dinamicos".
 *
 * What is worth asserting in a browser rather than a unit test: that the
 * results really LEFT the offer list (a second copy above the cards would be
 * exactly the clutter the user asked to remove), that the charts are generated
 * from the same data the tables show, and that every chart says its numbers in
 * TEXT - a chart that only painted its meaning would fail the whole point for
 * a screen reader or in greyscale.
 */

test.describe('analysis view', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications([
      {
        jobId: 'chart-applied',
        appliedAt: '2026-03-01T00:00:00.000Z',
        sourceIds: ['infojobs'],
        outcome: 'applied',
      },
      {
        jobId: 'chart-rejected',
        appliedAt: '2026-03-02T00:00:00.000Z',
        outcomeUpdatedAt: '2026-03-03T00:00:00.000Z',
        sourceIds: ['indeed'],
        outcome: 'rejected',
      },
    ]);
  });

  test('the results live on /analisis and the offer list no longer renders them', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Resultados de tus postulaciones' })).toHaveCount(
      0,
    );

    await page.goto('/analisis');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Análisis de tus postulaciones',
    );
    await expect(page.getByRole('region', { name: 'Resultados de tus postulaciones' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Diagramas' })).toBeVisible();
  });

  test('the skip link and the navigation point at the new view', async ({ page }) => {
    await page.goto('/analisis');

    // The skip link is still the first focusable element and targets THIS page.
    await expect(page.getByRole('link').first()).toContainText(
      'Saltar a los resultados y diagramas',
    );

    const nav = page.getByRole('navigation', { name: 'Secciones' });
    await expect(nav.getByRole('link', { name: 'Análisis' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Ofertas' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // And nowhere else.
    await page.goto('/');
    await expect(nav.getByRole('link', { name: 'Análisis' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('the funnel chart is generated from the data, stage by stage', async ({ page }) => {
    await page.goto('/analisis');

    const funnel = page.getByRole('list', { name: 'Embudo completo' });
    await expect(funnel).toBeVisible();
    // Six stages, in the order the metric cards show them.
    await expect(funnel.getByRole('listitem')).toHaveCount(6);
    // Two applications recorded, each with its rate from the previous stage AS TEXT.
    await expect(
      funnel.getByRole('listitem').filter({ hasText: 'Postulaciones' }),
    ).toContainText(/2 · \d+% desde la etapa anterior/);
    // One reply (the rejection counts), also spelled out, never only coloured.
    await expect(
      funnel.getByRole('listitem').filter({ hasText: 'Respuestas' }),
    ).toContainText(/1 · \d+% desde la etapa anterior/);
  });

  test('the per-source chart shows each source with its response rate', async ({ page }) => {
    await page.goto('/analisis');

    const sources = page.getByRole('list', { name: 'Por fuente' });
    await expect(sources.getByRole('listitem').filter({ hasText: 'infojobs' })).toContainText(
      '1 · 0% de respuesta',
    );
    await expect(sources.getByRole('listitem').filter({ hasText: 'indeed' })).toContainText(
      '1 · 100% de respuesta',
    );
  });

  test('the outcome chart says what happened after applying, rejections included', async ({
    page,
  }) => {
    await page.goto('/analisis');

    const outcomes = page.getByRole('list', { name: '¿Qué pasó después de postularte?' });
    await expect(outcomes.getByRole('listitem').filter({ hasText: 'Aplicada' })).toContainText(
      '1',
    );
    await expect(outcomes.getByRole('listitem').filter({ hasText: 'Rechazada' })).toContainText(
      '1',
    );
  });

  test('the model chart shows a Spanish empty state while no application names a model', async ({
    page,
  }) => {
    await page.goto('/analisis');

    await expect(page.getByRole('heading', { name: 'Por modelo de CV' })).toBeVisible();
    await expect(page.getByText('Todavía no has marcado ningún modelo de CV')).toBeVisible();
  });
});
