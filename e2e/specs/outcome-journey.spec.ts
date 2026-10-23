import { applyLinkFor, cardFor, expect, test } from '../support/test.js';
import { HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';
import { readApplications } from '../support/workspace.js';

/**
 * Recording what came back.
 *
 * The point of this journey is DURABILITY. A form that updates the screen but
 * not the disk looks identical to a correct one until the user comes back
 * tomorrow, so the assertion that matters is the one after `reload()`.
 */

const TITLE = HEALTHY_TITLES[1] as string;

test.describe('outcome journey', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('the outcome form only appears once there is an application to describe', async ({
    page,
  }) => {
    /*
     * Asking "how did it go?" about something the user never applied to is
     * noise, so the fieldset is absent until it has meaning.
     *
     * Matched by its LEGEND rather than by role alone: Chrome also maps the
     * score-breakdown `<details>` to role `group`, so a bare `getByRole('group')`
     * would find that instead and this assertion would be about the wrong
     * element in both directions.
     */
    const outcomeFieldset = cardFor(page, TITLE).getByRole('group', {
      name: 'Registrar el resultado',
    });
    await expect(outcomeFieldset).toHaveCount(0);

    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    await expect(outcomeFieldset).toBeVisible({ timeout: 15_000 });
  });

  test('setting an outcome persists across a reload', async ({ page }) => {
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    const card = cardFor(page, TITLE);
    await card.getByLabel('Estado').selectOption('interview');
    await card.getByLabel('Notas (opcional)').fill('Llamada el viernes');
    await card.getByRole('button', { name: 'Guardar estado' }).click();

    // The status chip is what the user scans the list by.
    await expect(card.getByText('Entrevista').first()).toBeVisible({ timeout: 15_000 });

    await page.reload();

    const reloaded = cardFor(page, TITLE);
    await expect(reloaded.getByText('Entrevista').first()).toBeVisible();
    await expect(reloaded.getByLabel('Estado')).toHaveValue('interview');
    await expect(reloaded.getByLabel('Notas (opcional)')).toHaveValue('Llamada el viernes');

    // And on disk, which is the claim the screen is standing in for.
    const recorded = await readApplications();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.outcome).toBe('interview');
    expect(recorded[0]?.notes).toBe('Llamada el viernes');
  });

  test('the stats panel starts empty and reacts to a real application', async ({ page }) => {
    await page.goto('/analisis');
    await expect(
      page.getByText('Todavía no hay postulaciones registradas.', { exact: false }),
    ).toBeVisible();

    await page.goto('/');
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });
    await page.reload();

    await page.goto('/analisis');
    const stats = page.getByRole('region', { name: 'Resultados de tus postulaciones' });
    await expect(stats.getByText('Postulaciones').first()).toBeVisible();

    // The denominator is shown next to the rate on purpose: "100% de respuesta"
    // over one application is noise, and hiding the denominator would let the
    // candidate act on it as if it were a finding.
    await expect(stats.getByText('0 de 1 respondieron')).toBeVisible();
    await expect(
      page.getByText('Menos de 10 postulaciones registradas', { exact: false }),
    ).toBeVisible();
  });
});
