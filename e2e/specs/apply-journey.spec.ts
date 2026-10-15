import { applyLinkFor, cardFor, expect, test } from '../support/test.js';
import { HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';
import { readApplications } from '../support/workspace.js';

/**
 * The journey the product exists for, driven through a real browser.
 *
 * The unit tests already prove `recordApplication` is idempotent. They prove it
 * by calling a function. This proves the HUMAN's double click is idempotent,
 * which is a different claim: it travels through a client component, a
 * `useTransition`, a server action, `revalidatePath`, a re-render and a JSON
 * file. Any one of those links can break while the function stays correct.
 */

const TITLE = HEALTHY_TITLES[0] as string;

test.describe('apply journey', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('the apply control opens in a new tab and cannot leak the opener', async ({ page }) => {
    const link = applyLinkFor(page, TITLE);

    /*
     * `target="_blank"` is load-bearing, not decoration: it is what lets the
     * posting open while this page stays alive to finish the server action.
     * Lose it and the navigation kills the in-flight write.
     */
    await expect(link).toHaveAttribute('target', '_blank');

    // `noopener` stops the opened page reaching back through `window.opener`.
    const rel = (await link.getAttribute('rel')) ?? '';
    expect(rel.split(/\s+/)).toContain('noopener');
  });

  test('clicking Aplicar records exactly one application and the UI reflects it', async ({
    page,
  }) => {
    expect(await readApplications()).toHaveLength(0);

    const link = applyLinkFor(page, TITLE);
    await expect(link).toContainText('Aplicar');

    await link.click();

    // The state the user sees. Waiting on this rather than on a timer is what
    // makes the assertion about the product instead of about a sleep.
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    const recorded = await readApplications();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.jobId).toBe(HEALTHY_QUEUE.jobs[0]?.id);
    // The score is read server-side from the queue, never sent by the browser.
    expect(recorded[0]?.scoreAtApply).toBe(HEALTHY_QUEUE.jobs[0]?.score);
    expect(recorded[0]?.cvVariant).toBe(HEALTHY_QUEUE.jobs[0]?.cvVariant);
  });

  test('the applied state survives a reload and is signalled without relying on colour', async ({
    page,
  }) => {
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    await page.reload();

    const link = applyLinkFor(page, TITLE);

    /*
     * WCAG 1.4.1: the applied/not-applied difference must survive greyscale.
     * Three redundant signals are asserted here because the component promises
     * three: the LABEL, the ICON, and only then the colour.
     */
    await expect(link).toContainText('Aplicada');
    await expect(link.locator('svg')).toHaveCount(2); // check mark + arrow
    await expect(cardFor(page, TITLE).getByText('Aplicada', { exact: true }).first()).toBeVisible();

    const background = await link.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('clicking Aplicar twice still records exactly ONE application', async ({ page }) => {
    const link = applyLinkFor(page, TITLE);

    await link.click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    // Second click, on the same control, as an impatient human would.
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    // The feedback line must say it was already there, not report a new record.
    await expect(cardFor(page, TITLE).getByText('Ya estaba registrada.')).toBeVisible({
      timeout: 15_000,
    });

    const recorded = await readApplications();
    expect(recorded).toHaveLength(1);
  });

  test('applying to one posting does not disturb the others', async ({ page }) => {
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    for (const other of HEALTHY_TITLES.slice(1)) {
      await expect(applyLinkFor(page, other)).toContainText('Aplicar');
    }
    expect(await readApplications()).toHaveLength(1);
  });
});
