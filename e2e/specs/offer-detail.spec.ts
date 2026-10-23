import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';

/**
 * Point 8 of the list, the second half: "Tendran que tener un boton de abrir ...
 * Cuando se de en abrir se tiene que abrir un modal (tambien con fondo blur con
 * detalles mas concretos de la oferta)".
 */

test('Abrir shows the offer in full, over a blurred page', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await page.goto('/');

  const card = page.locator('article').first();
  await card.getByRole('button', { name: 'Abrir' }).click();

  /* One dialog per card, so the assertion is scoped to the card it opened from. */
  const modal = card.getByTestId('offer-detail-modal');
  await expect(modal).toBeVisible();

  // The details the card had to compress: company, location and sources.
  await expect(modal).toContainText(HEALTHY_QUEUE.jobs[0]!.company);
  await expect(modal).toContainText('Ubicación');
  await expect(modal).toContainText('Fuentes');

  const style = await modal.evaluate((element) => {
    const background = getComputedStyle(element, '::backdrop') as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
    };
    return {
      surface: getComputedStyle(element).backgroundColor,
      backdrop: background.backgroundColor,
      blur: background.backdropFilter || background.webkitBackdropFilter,
    };
  });
  expect(style.surface).toBe('rgb(15, 23, 42)');
  expect(style.backdrop).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.blur).toContain('blur');

  await modal.getByRole('button', { name: 'Cerrar' }).click();
  await expect(modal).not.toBeVisible();
});
