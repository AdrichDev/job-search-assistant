import { applyLinkFor, expect, test } from '../support/test.js';
import { HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';
import { readApplications } from '../support/workspace.js';

/**
 * Keyboard-only smoke test.
 *
 * Not an axe-core audit - a small number of things a real keyboard user does,
 * verified end to end. The single most important one: the primary action of the
 * whole product must be reachable and activatable without a mouse. A product
 * whose one button needs a pointer is not usable by a chunk of the people it is
 * meant to serve.
 */

const TITLE = HEALTHY_TITLES[0] as string;

test.describe('accessibility smoke', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('Tab reaches the apply control and Enter activates it', async ({ page }) => {
    const link = applyLinkFor(page, TITLE);
    await expect(link).toBeVisible();

    // Walk the real tab order rather than calling .focus(); the point is that a
    // human pressing Tab gets there, not that the element is focusable in
    // principle.
    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await link.evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the apply control was not reachable by Tab within 40 stops').toBe(true);

    // Focus must be visible. An invisible focus ring makes a keyboard-navigable
    // page unusable in practice - you can reach the button but not see where
    // you are.
    const focusStyle = await link.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    const hasVisibleFocus =
      (focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth !== '0px') ||
      focusStyle.boxShadow !== 'none';
    expect(hasVisibleFocus, `no visible focus indicator: ${JSON.stringify(focusStyle)}`).toBe(true);

    await page.keyboard.press('Enter');
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });
    expect(await readApplications()).toHaveLength(1);
  });

  test('the apply control carries an accessible name naming the specific job', async ({ page }) => {
    // "Aplicar" alone is useless to someone tabbing through a list of links,
    // which all read "Aplicar". The name has to say which job.
    await expect(
      page.getByRole('link', { name: new RegExp(`Aplicar a ${TITLE}`) }),
    ).toBeVisible();
  });

  test('the page has one main landmark and a single level-1 heading', async ({ page }) => {
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('a normal session produces no console errors', async ({ page, console: log }) => {
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    await page.getByLabel('Buscar por puesto, empresa, ubicación o tecnología').fill('junior');
    await page.getByLabel('Versión del CV').selectOption('all');
    await page.reload();

    /*
     * Requests to third-party hosts are aborted by the harness, and an aborted
     * subresource is logged by the browser as a console error. That is the
     * TEST's doing, not the app's, so those lines are filtered out - keeping
     * them would either make this test permanently red or force it to be
     * deleted, and a deleted test catches nothing.
     */
    const appErrors = log.errors.filter(
      (message) => !/ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource/i.test(message),
    );

    expect(appErrors, `console errors:\n${appErrors.join('\n')}`).toEqual([]);
    expect(log.pageErrors, `uncaught exceptions:\n${log.pageErrors.join('\n')}`).toEqual([]);
  });
});
