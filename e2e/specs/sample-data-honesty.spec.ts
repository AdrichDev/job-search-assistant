import { cardFor, expect, test } from '../support/test.js';
import {
  HEALTHY_QUEUE,
  HEALTHY_TITLES,
  LEAKED_SAMPLE_QUEUE,
  LEAKED_SAMPLE_TITLE,
} from '../fixtures/queue.js';

/**
 * "THESE OFFERS ARE NOT REAL" HAS TO REACH THE SCREEN.
 *
 * The app already had an amber banner for invented data, and it was wired to
 * one condition: the OFFLINE FALLBACK, i.e. no persisted run existed at all.
 * That covered the case the app knew about and missed the case that shipped -
 * a genuine persisted run with sample postings inside it, which is what
 * `npm start -- --source=all` wrote and what any queue file from that build
 * still holds.
 *
 * `origin` cannot see that: the run WAS real. The honest question is about the
 * rows, so it is asked of the rows, and this spec is what proves the answer
 * arrives in front of a human.
 *
 * Two markers, deliberately, and both are asserted here: a banner at the top,
 * and a badge on the card. The banner alone is not enough - the list is longer
 * than a screen and the decision is made next to the Apply button, by which
 * point the banner has scrolled away.
 */

test.describe('sample data announces itself', () => {
  test('a persisted run containing sample postings still warns the user', async ({
    page,
    seed,
  }) => {
    await seed(LEAKED_SAMPLE_QUEUE);
    await page.goto('/');

    const notice = page.getByRole('status').filter({ hasText: /ejemplo/i });

    await expect(notice).toHaveCount(1);
    // The count, so the reader can check it against the list rather than
    // trusting an adjective.
    await expect(notice).toContainText('1 de las 3');
    // And the reason the link is dead, named.
    await expect(notice).toContainText('example-board.test');
  });

  test('the invented posting carries a badge on its own card', async ({ page, seed }) => {
    await seed(LEAKED_SAMPLE_QUEUE);
    await page.goto('/');

    await expect(cardFor(page, LEAKED_SAMPLE_TITLE)).toContainText('Ejemplo');
  });

  test('the real postings beside it are NOT badged', async ({ page, seed }) => {
    /*
     * The half of the assertion that stops the marker being decoration. A badge
     * on every card says nothing; the claim under test is that the interface
     * can tell these two kinds of row apart.
     */
    await seed(LEAKED_SAMPLE_QUEUE);
    await page.goto('/');

    for (const title of HEALTHY_TITLES.slice(0, 2)) {
      await expect(cardFor(page, title)).not.toContainText('Ejemplo');
    }
  });

  test('a queue of real postings shows no sample warning at all', async ({ page, seed }) => {
    // A banner that is always there is a banner nobody reads.
    await seed(HEALTHY_QUEUE);
    await page.goto('/');

    await expect(page.getByRole('article')).toHaveCount(HEALTHY_TITLES.length);
    await expect(page.getByRole('status').filter({ hasText: /ejemplo/i })).toHaveCount(0);
    await expect(page.getByText('Ejemplo', { exact: true })).toHaveCount(0);
  });

  test('the offline fallback keeps its own banner and does not double up', async ({
    page,
    seed,
  }) => {
    /*
     * With no queue file the app builds the fallback from the real committed
     * catalogue, so every row is sample data. Two amber boxes making the same
     * point is how a person learns to skip amber boxes, so the fallback notice
     * stays the only one - while the per-card badges still appear, because the
     * decision is still made down at the card.
     */
    await seed(null);
    await page.goto('/');

    await expect(page.getByRole('status').filter({ hasText: /ejemplo/i })).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: /ejemplo/i })).toContainText(
      'catálogo de ejemplo sin conexión',
    );
  });
});
