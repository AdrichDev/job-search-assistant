import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { CV_CATEGORY_QUEUE } from '../fixtures/queue.js';
import { LIBRARY_ROOT_PDF, seedCvModels } from '../support/cv-library.js';

/**
 * The CV category suggestion on each offer card (T3c).
 *
 * It is an explainable recommendation of a KIND of CV. It never names a model
 * or a PDF, never changes the legacy `cvVariant` chip or filter, and is absent
 * (not "General") on a legacy queue entry that was never analysed.
 */

const REGISTERED_NAME = 'Modelo Registrado Secreto';

const card = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });
const block = (page: Page, title: string) =>
  card(page, title).getByTestId('cv-category-suggestion');

test.describe('CV category suggestion', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seedCvModels([
      { id: 'secret-model', name: REGISTERED_NAME, relativePath: LIBRARY_ROOT_PDF },
    ]);
    await seed(CV_CATEGORY_QUEUE);
    await page.goto('/');
  });

  test('shows the category and the detected terms when there is evidence', async ({ page }) => {
    const suggestion = block(page, 'Desarrollador Java Spring');

    await expect(suggestion).toBeVisible();
    await expect(suggestion.getByRole('heading', { name: 'Categoría de CV sugerida' })).toBeVisible();
    await expect(suggestion).toContainText('Java / Spring backend');
    await expect(suggestion).toContainText('Términos detectados: java, spring');
    await expect(suggestion).toContainText(
      'Orientativa: no selecciona ni asigna ningún modelo de CV.',
    );
  });

  test('says there is no evidence instead of inventing one', async ({ page }) => {
    const suggestion = block(page, 'Desarrollador de software');

    await expect(suggestion).toContainText('General');
    await expect(suggestion).toContainText(
      'Sin evidencia suficiente en el título ni en la descripción.',
    );
    await expect(suggestion).not.toContainText('Términos detectados');
  });

  test('names the tied categories in Spanish', async ({ page }) => {
    const suggestion = block(page, 'Desarrollador Java y React');

    await expect(suggestion).toContainText('General');
    await expect(suggestion).toContainText('Empate entre Java / Spring backend y Frontend');
  });

  test('a legacy entry without a suggestion shows no block at all', async ({ page }) => {
    await expect(card(page, 'Desarrollador antiguo')).toBeVisible();
    await expect(block(page, 'Desarrollador antiguo')).toHaveCount(0);
    await expect(page.getByTestId('cv-category-suggestion')).toHaveCount(3);
  });

  test('sits after the chip row, and the requirement chips now live in the dialog', async ({ page }) => {
    /*
     * The requirement chips left the card when the list became the simplified
     * row: they open inside `Abrir` now, with the rest of the analysis.
     */
    const order = await card(page, 'Desarrollador Java Spring').evaluate((article) => {
      const chips = article.querySelector('[data-testid="cv-category-suggestion"]');
      const status = Array.from(article.querySelectorAll('span')).find((node) =>
        node.textContent?.includes('CV Frontend'),
      );
      const follows = (a: Element | null | undefined, b: Element | null | undefined) =>
        a !== null && a !== undefined && b !== null && b !== undefined
          ? Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
          : null;
      return { chipsBeforeBlock: follows(status, chips) };
    });

    expect(order.chipsBeforeBlock).toBe(true);
    // The requirement chips are nowhere on the card anymore.
    await expect(card(page, 'Desarrollador Java Spring').locator('[aria-label="Requisitos detectados"]')).toHaveCount(0);
  });

  test('the legacy CV version chip and its three filters are unchanged', async ({ page }) => {
    // The chip still reports the legacy variant, not the category.
    await expect(card(page, 'Desarrollador Java Spring')).toContainText('CV Frontend');
    await expect(card(page, 'Desarrollador de software')).toContainText('CV Microsoft');

    const filter = page.getByLabel('Versión del CV');
    await expect(filter.locator('option')).toHaveText([
      'Todas las versiones',
      'CV Frontend',
      'CV Microsoft',
      'CV General',
    ]);

    await filter.selectOption('frontend');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Desarrollador Java Spring' })).toBeVisible();

    await filter.selectOption('microsoft');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Desarrollador de software' })).toBeVisible();

    await filter.selectOption('general');
    await expect(page.getByRole('article')).toHaveCount(2);
  });

  test('never shows a PDF or a registered model name', async ({ page }) => {
    const text = await page.getByRole('main').innerText();

    expect(text.toLowerCase()).not.toContain('.pdf');
    expect(text).not.toContain(REGISTERED_NAME);
    for (const suggestion of await page.getByTestId('cv-category-suggestion').all()) {
      await expect(suggestion).not.toContainText(/\.pdf/i);
      await expect(suggestion.locator('a')).toHaveCount(0);
    }
  });
});
