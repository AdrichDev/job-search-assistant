import { consoleLogger } from '../src/adapters/logging/console-logger.js';
import { DEFAULT_QUEUE_PATH } from '../src/config/paths.js';

/**
 * `npm run seed:queue` - and why it now REFUSES instead of seeding.
 *
 * ====================================================================
 * The defect
 * ====================================================================
 *
 * This script used to restore `output/queue.json` from the 25 postings recorded
 * in `tests/fixtures/real-adzuna-run.ts`. The titles, companies and dates in
 * that fixture are real. The URLs were not: the fixture never captured them, so
 * it manufactured one per posting out of the job TITLE -
 *
 *   https://www.adzuna.es/details/Optima%20Solutions%20Junior%20Power%20Platform%20Developer
 *
 * - and this script wrote all of them into the queue the web UI reads. Every
 * apply button pointed at an HTTP 403. The real link the live API had returned,
 *
 *   https://www.adzuna.es/details/5874810786?utm_medium=api&utm_source=5327d1be
 *
 * had been discarded, and no copy of it survives anywhere in this repository.
 *
 * ====================================================================
 * Why refusing is the fix, rather than "seeding with a warning"
 * ====================================================================
 *
 * A seeded queue is indistinguishable from a real one on screen. It has titles,
 * companies, dates, requirement chips and a prominent Apply button. The only
 * thing wrong with it is the single field the user actually acts on, and that
 * field fails silently - a 403 in a new tab reads as "the offer expired", not
 * as "this tool made this up".
 *
 * So the trade is: an empty screen that says why, versus a full screen that
 * lies. The empty screen is strictly better. It is an honest statement about
 * what we have, and `apps/web` already renders it with recovery instructions.
 *
 * The script is kept rather than deleted so that `npm run seed:queue` explains
 * itself instead of erroring with "missing script", and so the reasoning above
 * is discoverable from the command a person would actually type.
 *
 * ====================================================================
 * What to do instead
 * ====================================================================
 *
 * Run a real source. The company boards need no API key and no quota:
 *
 *   npm start -- --source=boards
 *
 * If Adzuna's quota has recovered, `--source=all` includes it again. Both paths
 * produce URLs that came from the provider, which is the only kind this
 * pipeline is allowed to show.
 */

const MESSAGE = `
REFUSING to seed ${DEFAULT_QUEUE_PATH}.

Why:
  The recorded Adzuna run in tests/fixtures/real-adzuna-run.ts has no URLs.
  They were never captured, and no copy exists in this repository. Seeding
  from it would require inventing a link per posting - which is precisely
  the defect that shipped 13 dead apply buttons.

  A job with no source URL is not a job. Refusing is the correct outcome:
  an empty queue is an honest "nothing here yet"; a queue of clickable lies
  costs you a click, a tab, and your trust in every other row on the page.

What to run instead:
  npm start -- --source=boards      Greenhouse + Lever + Ashby. No API key, no quota.
  npm start -- --source=all         Adds Adzuna, if its free quota has recovered.

The fixture is still used - it is the regression corpus for the
software-relevance gate, which does not read URLs. It is simply not, and can
never again be, a source of postings a human is shown.
`.trim();

function main(): number {
  console.log('');
  console.log(MESSAGE);
  console.log('');
  // Non-zero: this command did not do what its name promises, and a script that
  // reports success while producing nothing is how a broken pipeline stays
  // broken for a week.
  return 1;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  consoleLogger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
