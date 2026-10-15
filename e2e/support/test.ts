import { test as base, expect, type Locator, type Page } from '@playwright/test';
import {
  removeQueue,
  resetApplications,
  resetDismissals,
  resetRunState,
  seedQueue,
} from './workspace.js';
import type { QueueFile } from '../fixtures/queue.js';

/**
 * The shared harness. Three things every spec gets for free.
 *
 * ## 1. The internet is unplugged
 *
 * This suite exists to check apply links, and the standing product rule is that
 * this project never automates a third-party job board (LinkedIn UA §8.2 and
 * the equivalent terms of every other board). Those two facts are in tension
 * the moment a test clicks a link with `target="_blank"`.
 *
 * The tension is resolved by routing at the CONTEXT level: anything that is not
 * our own origin is aborted before a packet leaves. Links are verified by
 * inspecting their attributes; the browser is never allowed to follow one out.
 * This also makes the suite hermetic - it passes with the network cable pulled.
 *
 * ## 2. Console errors are recorded
 *
 * Collected per test and asserted by the accessibility spec.
 *
 * ## 3. Seeding
 *
 * The queue is a file the server re-reads on every request (`force-dynamic`),
 * so a test can choose the data it faces by writing that file before it
 * navigates.
 */

export interface ConsoleCapture {
  readonly errors: string[];
  readonly pageErrors: string[];
}

interface Fixtures {
  /** Replaces the queue file, then hands back a helper to open the page. */
  readonly seed: (queue: QueueFile | null) => Promise<void>;
  readonly console: ConsoleCapture;
}

export const test = base.extend<Fixtures>({
  console: async ({ page }, use) => {
    const capture: ConsoleCapture = { errors: [], pageErrors: [] };

    page.on('console', (message) => {
      if (message.type() === 'error') {
        capture.errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      capture.pageErrors.push(error.message);
    });

    await use(capture);
  },

  seed: async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL ?? 'http://127.0.0.1:3178').origin;

    /*
     * Hard network boundary. `route` sees popups opened by target="_blank" too,
     * because it is registered on the context rather than a single page.
     */
    await context.route('**/*', async (route) => {
      const requested = new URL(route.request().url());
      if (requested.origin === origin) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });

    await resetApplications();
    // Dismissals and run state are reset for the same reason applications are:
    // a spec that asserts "one dismissal" must be measuring its own run, and a
    // lock left behind by a previous spec would make every later fetch read as
    // "already running".
    await resetDismissals();
    await resetRunState();

    await use(async (queue: QueueFile | null) => {
      if (queue === null) {
        await removeQueue();
      } else {
        await seedQueue(queue);
      }
    });
  },
});

export { expect };

/** Every apply control on the page, matched by accessible role and label. */
export function applyLinks(page: Page): Locator {
  return page.getByRole('link').filter({ hasText: /Aplicar|Aplicada/ });
}

/** The apply control on the card for one job title. */
export function applyLinkFor(page: Page, title: string): Locator {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
    .getByRole('link');
}

/** The card for one job title. */
export function cardFor(page: Page, title: string): Locator {
  return page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

/** The dismiss control on the card for one job title. */
export function dismissButtonFor(page: Page, title: string): Locator {
  return cardFor(page, title).getByRole('button', { name: /Descartar/ });
}

/** The collapsed review section holding everything the human said no to. */
export function dismissedSection(page: Page): Locator {
  return page.locator('details').filter({ hasText: /ofertas? descartadas?/i });
}

/** The restore control for one dismissed title, inside the review section. */
export function restoreButtonFor(page: Page, title: string): Locator {
  return dismissedSection(page)
    .locator('li')
    .filter({ hasText: title })
    .getByRole('button', { name: /Recuperar/ });
}

/** The "Buscar ofertas" control. */
export function fetchButton(page: Page): Locator {
  return page.getByRole('button', { name: /Buscar ofertas|Buscando ofertas/ });
}

/** The panel that reports what the fetch run is doing. */
export function fetchPanel(page: Page): Locator {
  return page.locator('section').filter({ has: page.locator('#fetch-heading') });
}
