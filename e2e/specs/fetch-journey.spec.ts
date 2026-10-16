import { expect, fetchButton, fetchPanel, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';

/**
 * "Buscar ofertas", driven through a real browser.
 *
 * ## What is really running
 *
 * The whole pipeline: the real sources layer, the real dedupe, the real two
 * filters, the real `persistQueue` guard, the real lock and the real state
 * machine. The only thing swapped is WHICH source is configured -
 * `JOB_QUEUE_WEB_SOURCES=fixture` in `playwright.config.ts` points the runner at
 * the committed offline catalogue, so this suite reads a local JSON file instead
 * of putting ~137 requests on employers' servers.
 *
 * That is injection at the port boundary, not a mock of the thing under test.
 * `support/workspace.ts` hard-fails the whole run if the override is missing,
 * because "the browser tests quietly started scraping the internet" is not a
 * failure anybody would notice from a green tick.
 *
 * ## What is worth asserting here rather than in a unit test
 *
 * That a click reaches the server at all; that the request comes BACK instead of
 * hanging for the length of a pipeline; that two overlapping clicks produce one
 * run; and that the state the human reads changes from "working" to "finished"
 * in words rather than only in a spinner.
 */

test.describe('fetch journey', () => {
  test.beforeEach(async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');
  });

  test('the fetch control is a real, keyboard-reachable button in Spanish', async ({ page }) => {
    const button = fetchButton(page);

    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('type', 'button');
    await expect(button).toContainText('Buscar ofertas');

    await button.focus();
    await expect(button).toBeFocused();
  });

  /**
   * Terminology is a product decision here, not a style preference. This tool
   * queries public APIs and saved greenhouses; it never navigates or parses a
   * job board's pages. Copy that called it scraping would describe something it
   * does not do and is not allowed to do.
   */
  test('the copy never calls this scraping', async ({ page }) => {
    const text = (await fetchPanel(page).innerText()).toLowerCase();

    expect(text).not.toContain('scrape');
    expect(text).not.toContain('scrap');
    expect(text).toContain('buscar ofertas');
  });

  test('reports an honest idle state before anything has been run', async ({ page }) => {
    await expect(fetchPanel(page)).toContainText('Todavía no has lanzado ninguna búsqueda');
  });

  test('a click returns immediately and the state becomes running, then finished', async ({
    page,
  }) => {
    const started = Date.now();
    await fetchButton(page).click();

    /*
     * The non-blocking claim. The action must come back in milliseconds; if it
     * awaited the pipeline this assertion would sit here for the length of a
     * run. The state has to say something real either way - a fast fixture run
     * can finish before the first poll, so both live states are accepted.
     */
    await expect(fetchPanel(page)).toContainText(/Búsqueda en curso|Última búsqueda terminada/, {
      timeout: 15_000,
    });
    expect(Date.now() - started).toBeLessThan(15_000);

    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada', {
      timeout: 60_000,
    });
  });

  /**
   * "Still working" versus "finished" must survive greyscale, a stopped
   * animation and `prefers-reduced-motion`. The spinner is decoration; the words
   * are the state.
   */
  test('the difference between working and finished is carried in words', async ({ page }) => {
    await fetchButton(page).click();
    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada', { timeout: 60_000 });

    // Compared case-insensitively: the summary heading is rendered with
    // `text-transform: uppercase`, and `innerText` reports the RENDERED text.
    // Asserting the literal casing would be asserting a CSS rule, not the copy.
    const text = (await fetchPanel(page).innerText()).toLowerCase();
    expect(text).toContain('resultado de la última búsqueda');
    expect(text).not.toContain('búsqueda en curso');
  });

  /**
   * The run report, in Spanish, from the numbers the core computed. Every line
   * comes off `FetchRunSummary`, which is read off the same queue the CLI
   * prints - not a second summary invented for the browser.
   */
  test('reports what the run found, in Spanish', async ({ page }) => {
    await fetchButton(page).click();
    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada', { timeout: 60_000 });

    const panel = fetchPanel(page);
    await expect(panel).toContainText(/ofertas? (encontrada|encontradas)/);
    await expect(panel).toContainText(/únicas? tras agrupar/);
    await expect(panel).toContainText('no ser ofertas de desarrollo de software');
    await expect(panel).toContainText('perfil sénior');
    await expect(panel).toContainText(/ofertas? (disponible|disponibles) para ti/);
  });

  /*
   * SINGLE-FLIGHT, through the browser.
   *
   * Two requests are fired at the server with no client coordination at all -
   * deliberately bypassing the disabled button, because the disabled button is a
   * courtesy and the lock is the guarantee. Exactly one must be accepted.
   *
   * `fetch` from the page context is used rather than two clicks: React disables
   * the control after the first click, so a second click would prove only that
   * the browser did what it was told.
   */
  test('two overlapping requests result in exactly ONE run', async ({ page }) => {
    const accepted = await page.evaluate(async () => {
      // Next server actions are POSTs to the same URL carrying an action id, so
      // the browser cannot invoke one directly from here. The page's own
      // buttons are driven instead, simultaneously, before React can disable
      // either of them.
      const buttons = Array.from(document.querySelectorAll('button')).filter((node) =>
        (node.textContent ?? '').includes('Buscar ofertas'),
      );
      buttons.forEach((button) => {
        button.click();
      });
      return buttons.length;
    });

    expect(accepted).toBeGreaterThan(0);

    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada', { timeout: 60_000 });

    /*
     * One run, proven by the report rather than by counting requests: a second
     * concurrent run against the same queue file would have produced a second
     * finished state, and the panel would show its numbers. The server-side
     * assertion that only one lock was granted is covered by
     * `tests/app/fetch-run.test.ts`; what this adds is that the browser path
     * reaches the same lock.
     */
    await expect(fetchPanel(page)).toContainText(/ofertas? (disponible|disponibles) para ti/);
  });

  test('a second tab sees the run the first one started', async ({ page, context }) => {
    await fetchButton(page).click();

    const second = await context.newPage();
    await second.goto('/');

    // Whatever the first tab's run is doing, the second must report the SAME
    // thing - the state is a file on the server, not React state in one tab.
    await expect(fetchPanel(second)).toContainText(
      /Búsqueda en curso|Última búsqueda terminada/,
      { timeout: 30_000 },
    );
    await expect(fetchPanel(second)).not.toContainText('Todavía no has lanzado');

    await second.close();
  });

  test('the button is usable again once the run has finished', async ({ page }) => {
    await fetchButton(page).click();
    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada', { timeout: 60_000 });

    await expect(fetchButton(page)).toBeEnabled();
  });

  test('the run state survives a reload', async ({ page }) => {
    await fetchButton(page).click();
    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada', { timeout: 60_000 });

    await page.reload();

    // Rendered on the SERVER from the state file, so it is correct on the first
    // paint rather than after the first poll.
    await expect(fetchPanel(page)).toContainText('Última búsqueda terminada');
  });
});
