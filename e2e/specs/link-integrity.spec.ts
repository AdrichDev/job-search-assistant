import { applyLinks, expect, test } from '../support/test.js';
import { describeLinkProblems, inspectLink, type LinkProblem } from '../support/link-integrity.js';
import { FABRICATED_URL_QUEUE, HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';

/**
 * The regression test for the defect that motivated this suite.
 *
 * Thirteen apply buttons shipped pointing at
 * `https://www.aggregator.es/details/<url-encoded job title>`. Every one returned
 * HTTP 403. 626 unit tests were green the whole time, because not one of them
 * rendered the page and looked at a link.
 *
 * This spec renders the page and looks at every link.
 *
 * ## The blind spot this spec has, and where it is covered
 *
 * Every queue below is one THIS SUITE SEEDED. That is the right design for a
 * UI test - controlling the data is how you control the page - and it is also
 * why this spec cannot notice a bad queue the PIPELINE produced. It was green
 * throughout the run that put two `example-board.test` postings at positions #1
 * and #3 of the user's real list.
 *
 * The rules it applies now come from `@job-queue/core/domain`
 * (`src/domain/link-provenance.ts`), so the same definitions are enforced
 * against pipeline output in two more places:
 *
 *   - `packages/core/tests/app/pipeline-link-provenance.test.ts`, over a queue
 *     built by the real adapters through the real `buildJobQueue`;
 *   - the CLI itself, which audits the queue it just built on every run before
 *     writing it (`renderLinkAudit`).
 *
 * Note what is deliberately NOT here: no request is made to any of these URLs.
 * Fetching them would be exactly the third-party-board traffic this project
 * refuses to generate, and it would also make the suite depend on the internet
 * being up and a stranger's server staying at HTTP 200. Provenance is checked
 * from the attribute, which is where the defect actually lived.
 */

/**
 * Walks the CARDS, not the links.
 *
 * Card-first matters: the title and the href have to be read from the same
 * `<article>` or the pairing is a guess, and the rule being checked is about
 * the relationship between those two values. Reading two independent ordered
 * lists and zipping them would quietly go wrong the day a card renders a second
 * link.
 */
async function collectProblems(page: import('@playwright/test').Page): Promise<LinkProblem[]> {
  const origin = new URL(page.url()).origin;
  const cards = page.getByRole('article');
  const count = await cards.count();
  const problems: LinkProblem[] = [];

  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const link = card.getByRole('link').filter({ hasText: /Aplicar|Aplicada/ }).first();

    problems.push(
      ...inspectLink(
        {
          href: await link.getAttribute('href'),
          title: (await card.getByRole('heading').first().innerText()).trim(),
          target: await link.getAttribute('target'),
          rel: await link.getAttribute('rel'),
        },
        origin,
      ),
    );
  }

  return problems;
}

test.describe('apply link integrity', () => {
  test('every apply link on the page is a usable external posting address', async ({
    page,
    seed,
  }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');

    const links = applyLinks(page);

    // The check is worthless if the page rendered nothing to check. This is the
    // assertion that stops "zero links, zero problems, green" - which is how a
    // link test silently stops testing anything.
    await expect(links).toHaveCount(HEALTHY_TITLES.length);

    const problems = await collectProblems(page);
    expect(
      problems,
      problems.length === 0 ? '' : `\n${describeLinkProblems(problems)}\n`,
    ).toHaveLength(0);
  });

  test('the same check FAILS against the fabricated URLs that shipped', async ({ page, seed }) => {
    /*
     * The proof that test above can fail.
     *
     * A green regression test is only evidence if you have watched it go red
     * against the original defect. This runs the identical rules over the
     * identical page with the identical job titles - the ONLY difference is
     * that the URLs are the synthesised ones - and asserts that all three are
     * rejected, naming the rule that rejects them.
     */
    await seed(FABRICATED_URL_QUEUE);
    await page.goto('/');

    await expect(applyLinks(page)).toHaveCount(HEALTHY_TITLES.length);

    const problems = await collectProblems(page);

    expect(problems).toHaveLength(HEALTHY_TITLES.length);
    expect(problems.every((problem) => problem.rule === 'title-derived')).toBe(true);
    expect(problems.map((problem) => problem.title).sort()).toEqual([...HEALTHY_TITLES].sort());

    // And the thing that fooled everyone: these are perfectly valid URLs.
    for (const problem of problems) {
      expect(() => new URL(problem.href)).not.toThrow();
      expect(new URL(problem.href).protocol).toBe('https:');
      expect(problem.href).toContain('aggregator.es');
    }
  });

  test('an apply link never resolves back into this application', async ({ page, seed }) => {
    await seed(HEALTHY_QUEUE);
    await page.goto('/');

    const origin = new URL(page.url()).origin;
    const hrefs = await applyLinks(page).evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
    );

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      // `new URL(href, origin)` is what the BROWSER does. A relative href looks
      // harmless in a snapshot and lands the user on our own page.
      expect(new URL(href, origin).origin).not.toBe(origin);
    }
  });
});
