import { applyLinks, expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';

/**
 * The interface is in Spanish because the person using it asked for it in
 * Spanish.
 *
 * There is a unit test over `es.ts` already, and it proves the strings exist.
 * It cannot prove they are the strings that reach the screen: a component
 * hard-coding "Apply" next to an unused `ES.apply.action` passes that test and
 * fails the user. This one reads the rendered page.
 */

test.describe('Spanish copy', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('the primary surfaces render in Spanish', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ofertas para ti');

    // The first link in the document is the skip link, which is itself Spanish
    // copy worth asserting - a keyboard user meets it before anything else.
    await expect(page.getByRole('link').first()).toContainText('Saltar a la lista de ofertas');
    await expect(applyLinks(page).first()).toContainText('Aplicar');
    await expect(page.getByLabel('Versión del CV')).toBeVisible();
    await expect(page.getByLabel('Estado de la postulación')).toBeVisible();
    await expect(page.getByText('Resultados de tus postulaciones')).toBeVisible();

    // The sentence that stops the user wondering whether the click also wrote
    // something. Its absence is a consent problem, not a copy problem.
    await expect(
      page.getByText('Abre la oferta en una pestaña nueva y registra la postulación.').first(),
    ).toBeVisible();
  });

  test('the boundary promise is stated on the page, not only in the README', async ({ page }) => {
    // This product does not log into any job board on the user's behalf. That
    // is a legal and product boundary, and the person using it deserves to read
    // it on the screen where they click, not in a document they never open.
    await expect(
      page.getByText(
        'Te postulas tú en el portal de empleo. Esta herramienta no inicia sesión en ningún sitio ni envía nada por ti.',
      ),
    ).toBeVisible();
  });

  test('the document language and title are Spanish', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Ofertas de tecnología para perfil junior/);
  });

  test('no untranslated English leaks into the rendered interface', async ({ page }) => {
    const text = (await page.getByRole('main').innerText()).toLowerCase();

    /*
     * Word-boundary matched, and deliberately short. A long banned-word list
     * turns into false positives the moment a real company is called "Apply
     * Digital", so this covers only the labels this UI would plausibly regress
     * to.
     */
    for (const english of ['apply now', 'not applied', 'response rate', 'no jobs found']) {
      expect(text, `found untranslated copy: "${english}"`).not.toContain(english);
    }
  });
});
