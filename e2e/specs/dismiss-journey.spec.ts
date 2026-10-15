import {
  applyLinkFor,
  cardFor,
  dismissButtonFor,
  dismissedSection,
  expect,
  restoreButtonFor,
  test,
} from '../support/test.js';
import { HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';
import { readDismissals, seedQueue } from '../support/workspace.js';

/**
 * "I am not interested in this one", driven through a real browser.
 *
 * The unit tests already prove `dismissJob` is idempotent and that
 * `partitionByDismissal` hides the right row. They prove it by calling
 * functions. This proves the HUMAN's click does it - which is a different claim,
 * because it travels through a client component, a `useTransition`, a server
 * action, `revalidatePath`, a re-render and a JSON file, and any one of those
 * links can break while both functions stay correct.
 */

const TITLE = HEALTHY_TITLES[0] as string;
const OTHER = HEALTHY_TITLES[1] as string;

test.describe('dismiss journey', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('the dismiss control is a real, keyboard-reachable button', async ({ page }) => {
    const button = dismissButtonFor(page, TITLE);

    await expect(button).toBeVisible();
    // A real <button>, not a div with an onClick: that is what buys Enter,
    // Space, focus order and the screen-reader role for free.
    await expect(button).toHaveAttribute('type', 'button');

    await button.focus();
    await expect(button).toBeFocused();
  });

  /**
   * The visual hierarchy, asserted rather than promised.
   *
   * Apply owns the accent and is the only filled control on the card. If dismiss
   * ever grows a filled background it will start competing for the eye, and this
   * is where that regression gets caught.
   */
  test('dismiss stays visually secondary to Apply', async ({ page }) => {
    const apply = applyLinkFor(page, TITLE);
    const dismiss = dismissButtonFor(page, TITLE);

    const applyBackground = await apply.evaluate((node) => getComputedStyle(node).backgroundColor);
    const dismissBackground = await dismiss.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );

    expect(applyBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(dismissBackground).toBe('rgba(0, 0, 0, 0)');
  });

  test('clicking Descartar hides the offer and records exactly one dismissal', async ({ page }) => {
    expect(await readDismissals()).toHaveLength(0);
    await expect(cardFor(page, TITLE)).toBeVisible();

    await dismissButtonFor(page, TITLE).click();

    // The state the user sees. Waiting on this rather than on a timer makes the
    // assertion about the product instead of about a sleep.
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    const recorded = await readDismissals();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.jobId).toBe(HEALTHY_QUEUE.jobs[0]?.id);
    // The snapshot is read server-side from the queue, never sent by the browser.
    expect(recorded[0]?.title).toBe(TITLE);
  });

  test('dismissing one offer does not disturb the others', async ({ page }) => {
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    for (const other of HEALTHY_TITLES.slice(1)) {
      await expect(cardFor(page, other)).toBeVisible();
    }
    expect(await readDismissals()).toHaveLength(1);
  });

  test('the offer STAYS gone after a reload', async ({ page }) => {
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    await page.reload();

    await expect(cardFor(page, TITLE)).toHaveCount(0);
    await expect(cardFor(page, OTHER)).toBeVisible();
  });

  /**
   * SURVIVES A RE-RUN, in the browser.
   *
   * The queue file is replaced wholesale, exactly as a pipeline run replaces it,
   * with the same postings under the same fingerprint ids and newer timestamps.
   * The dismissal lives in its own store and must hide the same vacancy again.
   */
  test('the offer stays gone after the pipeline writes a fresh queue', async ({ page }) => {
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    await seedQueue({
      ...HEALTHY_QUEUE,
      generatedAt: '2026-03-11T09:00:00.000Z',
      jobs: HEALTHY_QUEUE.jobs.map((job) => ({ ...job, postedAt: '2026-03-11T08:00:00.000Z' })),
    });
    await page.reload();

    await expect(cardFor(page, TITLE)).toHaveCount(0);
    // And the run genuinely did produce the other postings, so the assertion
    // above is about the dismissal rather than about an empty page.
    await expect(cardFor(page, OTHER)).toBeVisible();
  });

  test('the headline count agrees with the shortened list', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '3 ofertas' })).toBeVisible();

    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: '2 ofertas' })).toBeVisible();
  });

  test('the review section lists the dismissed offer and restores it', async ({ page }) => {
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    const section = dismissedSection(page);
    await expect(section).toBeVisible();
    // Collapsed by default: a decision already made must not re-present itself
    // at full size on every visit.
    await expect(section).not.toHaveAttribute('open', /.*/);

    await section.locator('summary').click();
    // `.first()`: the title appears twice inside the row on purpose - once
    // visibly and once in the restore button's screen-reader label, which is
    // what tells a non-sighted user WHICH offer that button restores.
    await expect(section.getByText(TITLE).first()).toBeVisible();

    await restoreButtonFor(page, TITLE).click();

    await expect(cardFor(page, TITLE)).toBeVisible({ timeout: 15_000 });
    expect(await readDismissals()).toHaveLength(0);
  });

  test('a restored offer survives a reload', async ({ page }) => {
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    await dismissedSection(page).locator('summary').click();
    await restoreButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(cardFor(page, TITLE)).toBeVisible();
    // Nothing left in the review section, so it is not rendered at all.
    await expect(dismissedSection(page)).toHaveCount(0);
  });

  /*
   * THE CONFLICT, as the human meets it.
   *
   * The control is disabled and SAYS why, rather than vanishing. A control that
   * disappears looks like a bug; one that explains itself teaches the rule and
   * points at the outcome form, which records "this went nowhere" truthfully
   * instead of erasing the application.
   */
  test('an applied offer cannot be dismissed, and the interface says why', async ({ page }) => {
    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    await expect(dismissButtonFor(page, TITLE)).toHaveCount(0);

    const blocked = cardFor(page, TITLE).getByRole('button', { name: 'Ya postulada' });
    await expect(blocked).toBeVisible();
    await expect(blocked).toBeDisabled();
    // Points at the move that DOES work, rather than only refusing.
    await expect(cardFor(page, TITLE)).toContainText('Registrar el resultado');

    expect(await readDismissals()).toHaveLength(0);
  });

  /**
   * The other direction. Applying is an unambiguous statement of interest and
   * supersedes an earlier "no", which is what keeps the outcome form reachable.
   */
  test('applying to a dismissed offer brings it back', async ({ page }) => {
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });

    await dismissedSection(page).locator('summary').click();
    await restoreButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toBeVisible({ timeout: 15_000 });

    await applyLinkFor(page, TITLE).click();
    await expect(applyLinkFor(page, TITLE)).toContainText('Aplicada', { timeout: 15_000 });

    expect(await readDismissals()).toHaveLength(0);
    await expect(cardFor(page, TITLE)).toBeVisible();
  });

  test('the copy says the action is reversible instead of asking for confirmation', async ({
    page,
  }) => {
    // No dialog: this is not destructive, and training a person to click through
    // dialogs is how a real one gets ignored later.
    await expect(cardFor(page, TITLE)).toContainText('Puedes recuperarla cuando quieras');
    await dismissButtonFor(page, TITLE).click();
    await expect(cardFor(page, TITLE)).toHaveCount(0, { timeout: 15_000 });
  });
});
