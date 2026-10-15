import { cardFor, expect, test } from '../support/test.js';
import {
  HEALTHY_QUEUE,
  HEALTHY_TITLES,
  MIXED_LIVENESS_QUEUE,
  UNVERIFIED_TITLE,
} from '../fixtures/queue.js';

/**
 * "WE COULD NOT CHECK THIS ONE" HAS TO REACH THE SCREEN - QUIETLY.
 *
 * The pipeline now removes postings whose address answers 404 or 410. Everything
 * else is kept, including the ones it could not reach at all: 403 from a
 * bot-protected careers site, a timeout, a connection reset. Two live CaixaBank
 * Tech junior roles are in exactly that state, and deleting them would have been
 * invisible and unrecoverable.
 *
 * Keeping them creates a second obligation, which is what this spec is about. A
 * posting we could not verify must not be presented as though we had. But the
 * mark has to stay QUIET, and that constraint is as load-bearing as the mark
 * itself: on a real run this fires on ordinary bot protection, and an amber
 * warning on a live vacancy would teach the reader to distrust the list - and
 * would drown the "Ejemplo" badge, which marks a posting that genuinely is not
 * real.
 *
 * So the assertions come in pairs: the badge IS there, and it does NOT look
 * like an alarm.
 */

test.describe('unverified links are marked, not hidden and not alarming', () => {
  test('a posting the checker could not reach carries a badge on its own card', async ({
    page,
    seed,
  }) => {
    await seed(MIXED_LIVENESS_QUEUE);
    await page.goto('/');

    await expect(cardFor(page, UNVERIFIED_TITLE)).toContainText('Sin verificar');
  });

  test('the postings it DID confirm are not badged', async ({ page, seed }) => {
    /*
     * The half that stops the badge being decoration. A mark on every card says
     * nothing; the claim is that the interface can tell the two apart.
     */
    await seed(MIXED_LIVENESS_QUEUE);
    await page.goto('/');

    for (const title of HEALTHY_TITLES.slice(1)) {
      await expect(cardFor(page, title)).not.toContainText('Sin verificar');
    }
  });

  test('the unverified posting is still in the list, with a working Apply button', async ({
    page,
    seed,
  }) => {
    /*
     * THE POINT OF THE WHOLE FEATURE, asserted from the user's side: the offer
     * we could not verify is still here, still applicable, still linked to its
     * real address. "Kept" has to mean kept, not greyed out and not disabled.
     */
    await seed(MIXED_LIVENESS_QUEUE);
    await page.goto('/');

    const card = cardFor(page, UNVERIFIED_TITLE);
    await expect(card).toBeVisible();

    const applyLink = card.getByRole('link', { name: /aplicar/i });
    await expect(applyLink).toBeVisible();
    await expect(applyLink).toHaveAttribute('href', /^https:\/\/boards\.greenhouse\.io\//);
  });

  test('the badge explains itself and says the offer was kept', async ({ page, seed }) => {
    await seed(MIXED_LIVENESS_QUEUE);
    await page.goto('/');

    const badge = cardFor(page, UNVERIFIED_TITLE).getByTitle(/no pudimos verificar este enlace/i);

    await expect(badge).toHaveCount(1);
    // The reassurance is not optional. Without it the badge reads as "this job
    // is probably dead", which is precisely backwards.
    await expect(badge).toHaveAttribute('title', /se mantiene en la lista/i);
  });

  test('the mark is quiet: no page-level alert is raised for an unverified link', async ({
    page,
    seed,
  }) => {
    /*
     * There is no banner for this, on purpose. A bot-protected careers site is
     * an ordinary Tuesday, and spending the page's one loud channel on it is
     * how the sample-data warning - which marks INVENTED offers - stops being
     * read.
     */
    await seed(MIXED_LIVENESS_QUEUE);
    await page.goto('/');

    /*
     * Asserted against the app's OWN banner component, not `getByRole('alert')`.
     * Next.js injects `#__next-route-announcer__` with `role="alert"` into every
     * page for screen-reader routing, so that locator matches one element on any
     * page in any state - asserting on it would test the framework and pass or
     * fail for reasons that have nothing to do with this feature.
     */
    await expect(page.getByRole('status').filter({ hasText: /verificar/i })).toHaveCount(0);

    // And the card itself keeps its ordinary styling. The amber rail belongs to
    // the sample-data badge, which marks an INVENTED posting; an unverified one
    // is real and must not borrow that weight.
    await expect(cardFor(page, UNVERIFIED_TITLE)).not.toHaveClass(/amber/);
  });

  test('a queue with no liveness information at all shows no badges', async ({ page, seed }) => {
    /*
     * `--no-check-links`, or a queue file written before the feature existed.
     * Marking every card "Sin verificar" would be technically true and
     * completely useless: it would say nothing about any individual posting and
     * would cost the badge all its meaning for the runs where it does mean
     * something.
     */
    await seed(HEALTHY_QUEUE);
    await page.goto('/');

    await expect(page.getByRole('article')).toHaveCount(HEALTHY_TITLES.length);
    await expect(page.getByText('Sin verificar', { exact: true })).toHaveCount(0);
  });
});
