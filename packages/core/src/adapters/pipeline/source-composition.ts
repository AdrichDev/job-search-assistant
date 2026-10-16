import { companiesFor } from '../../config/company-boards.js';
import type { SelectableSourceId } from '../../cli/source-selection.js';
import type { JobSource } from '../../ports/job-source.js';
import type { LinkChecker } from '../../ports/link-checker.js';
import type { Logger } from '../../ports/logger.js';
import { createArbeitnowJobSource } from '../arbeitnow/arbeitnow-job-source.js';
import { createAshbyJobSource } from '../boards/ashby-board.js';
import { createGreenhouseJobSource } from '../boards/greenhouse-board.js';
import { createLeverJobSource } from '../boards/lever-board.js';
import { createSmartRecruitersJobSource } from '../boards/smartrecruiters-board.js';
import { createFixtureJobSource } from '../fixture/fixture-job-source.js';
import { createLandingJobsSource } from '../landingjobs/landingjobs-job-source.js';
import {
  createHttpLinkChecker,
  DEFAULT_LIVENESS_CONCURRENCY,
} from '../liveness/http-link-checker.js';
import { createJsonLivenessCache } from '../liveness/json-liveness-cache.js';
import { createManfredJobSource } from '../manfred/manfred-job-source.js';

/**
 * The one place where selected source ids become `JobSource` instances.
 *
 * Both composition roots (the CLI and the web fetch button) used to carry their
 * own copy of this table, so adding a source meant editing two files and
 * remembering to keep them identical. They now differ only in what they inject:
 * the logger and the clock.
 *
 * Whether the program talks to the internet (link resolution, liveness
 * checking) is still decided by the CALLER through the flags below, never
 * defaulted here.
 */
export interface SourceCompositionOptions {
  readonly fixturePath: string;
  readonly livenessCachePath: string;
  /** Remove postings whose address answers HTTP 404 or 410. Nothing else. */
  readonly checkLinks: boolean;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly now: () => Date;
}

/**
 * `undefined`, not a do-nothing checker, when checking is off.
 *
 * `undefined` is the ONLY way to say "off". A second way once made a
 * `--no-check-links` run report "0 checked, 0 reachable" - a report about a
 * pass that never happened.
 */
export function buildLinkChecker(options: SourceCompositionOptions): LinkChecker | undefined {
  if (!options.checkLinks) {
    return undefined;
  }

  return createHttpLinkChecker({
    cache: createJsonLivenessCache({ filePath: options.livenessCachePath }),
    logger: options.logger,
    now: options.now,
    concurrency: DEFAULT_LIVENESS_CONCURRENCY,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * One lazy factory per selectable source.
 *
 * Lazy so sources are constructed only when selected and one unavailable
 * provider can still be isolated by the caller.
 */
export function buildSourceFactories(
  options: SourceCompositionOptions,
): Readonly<Record<SelectableSourceId, () => JobSource>> {
  const { logger, now, timeoutMs, concurrency } = options;
  const boardOptions = { logger, concurrency, timeoutMs, now };

  return {
    fixture: () => createFixtureJobSource({ filePath: options.fixturePath, now }),

    manfred: () => createManfredJobSource({ logger, timeoutMs, concurrency, now }),

    greenhouse: () =>
      createGreenhouseJobSource({ ...boardOptions, companies: companiesFor('greenhouse') }),
    lever: () => createLeverJobSource({ ...boardOptions, companies: companiesFor('lever') }),
    ashby: () => createAshbyJobSource({ ...boardOptions, companies: companiesFor('ashby') }),
    smartrecruiters: () =>
      createSmartRecruitersJobSource({
        ...boardOptions,
        companies: companiesFor('smartrecruiters'),
      }),

    landingjobs: () => createLandingJobsSource({ logger, timeoutMs, now }),
    arbeitnow: () => createArbeitnowJobSource({ logger, timeoutMs, now }),

  };
}
