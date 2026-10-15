import { createAdzunaJobSource } from '../adzuna/adzuna-job-source.js';
import { createArbeitnowJobSource } from '../arbeitnow/arbeitnow-job-source.js';
import { createAshbyJobSource } from '../boards/ashby-board.js';
import { createGreenhouseJobSource } from '../boards/greenhouse-board.js';
import { createLandingJobsSource } from '../landingjobs/landingjobs-job-source.js';
import { createLeverJobSource } from '../boards/lever-board.js';
import { createManfredJobSource } from '../manfred/manfred-job-source.js';
import { createSmartRecruitersJobSource } from '../boards/smartrecruiters-board.js';
import { createFixtureJobSource } from '../fixture/fixture-job-source.js';
import { createHttpLinkChecker } from '../liveness/http-link-checker.js';
import { createJsonLivenessCache } from '../liveness/json-liveness-cache.js';
import { createJsonLinkCache } from '../newsletter/json-link-cache.js';
import {
  createPassthroughLinkResolver,
  createRedirectLinkResolver,
} from '../newsletter/link-resolver.js';
import { createNewsletterJobSource } from '../newsletter/newsletter-job-source.js';
import { createJsonFileQueueReader } from '../output/json-file-queue-reader.js';
import { createJsonFileQueueWriter } from '../output/json-file-queue-writer.js';
import { buildJobQueue } from '../../app/build-job-queue.js';
import { persistQueue } from '../../app/persist-queue.js';
import { summarizeRun } from '../../app/summarize-run.js';
import { loadCandidateProfile } from '../../config/candidate-profile.js';
import { companiesFor } from '../../config/company-boards.js';
import { loadAdzunaCredentials } from '../../config/env.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../config/junior-filter-config.js';
import { DEFAULT_NEWSLETTER_LINK_CONCURRENCY } from '../../config/newsletter.js';
import { DEFAULT_SCORING_CONFIG } from '../../config/scoring-config.js';
import { DEFAULT_SEARCH_PLAN } from '../../config/search-plan.js';
import { DEFAULT_LIVENESS_CONCURRENCY } from '../liveness/http-link-checker.js';
import type { SelectableSourceId } from '../../cli/source-selection.js';
import type { JobSource, JobSourceQuery } from '../../ports/job-source.js';
import type { LinkChecker } from '../../ports/link-checker.js';
import type { Logger } from '../../ports/logger.js';
import type { PipelineRunner } from '../../ports/pipeline-runner.js';
import type { FetchRunSummary } from '../../ports/run-state-store.js';

/**
 * One whole ingestion run, packaged behind `PipelineRunner`.
 *
 * This is the composition the CLI performs in `cli/main.ts`, extracted so a
 * second caller - the web app's fetch button - can perform the identical run
 * without React learning what a job board is. Same sources, same two filters,
 * same liveness rule, and critically the same `persistQueue` guard, so the
 * button cannot overwrite a good queue with a broken run's emptiness.
 *
 * `cli/main.ts` is deliberately NOT refactored onto this. It renders eight
 * different report sections and drains newsletter link provenance on the way
 * through; folding all of that in here to save a duplicated `switch` would
 * enlarge this module's job from "run the pipeline" to "run the pipeline and
 * know how a terminal wants to read it". The duplication is one factory table,
 * it is visible in both files, and both are covered by tests.
 */

export interface QueuePipelineRunnerOptions {
  readonly sources: readonly SelectableSourceId[];
  readonly outputPath: string;
  readonly fixturePath: string;
  readonly newsletterDir: string;
  readonly linkCachePath: string;
  readonly livenessCachePath: string;
  /** Follow newsletter tracking links to the employer's real posting. */
  readonly resolveLinks: boolean;
  /** Remove postings whose address answers HTTP 404 or 410. Nothing else. */
  readonly checkLinks: boolean;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly logger: Logger;
  readonly now: () => Date;
}

/**
 * A source that exists only to fail on demand.
 *
 * Used when a source cannot even be CONSTRUCTED - in practice, Adzuna with no
 * credentials configured. Throwing during construction would abort the whole
 * run before a single board was asked, which would let one missing API key cost
 * the user every free source as well.
 *
 * Deferring the throw to `fetchJobs` routes the failure straight into
 * `buildJobQueue`'s existing per-source isolation, so it lands in
 * `sourceReports` as an ordinary failed query, is reported to the user by name,
 * and correctly makes the run `degraded` rather than `healthy` - which is what
 * stops an empty result from that run being trusted enough to overwrite the
 * queue. Inventing a parallel error path here would have had to reproduce all
 * four of those behaviours.
 */
function unavailableSource(id: string, cause: unknown): JobSource {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    id,
    fetchJobs: (_query: JobSourceQuery) => Promise.reject(new Error(message)),
  };
}

function buildLinkResolver(options: QueuePipelineRunnerOptions) {
  if (!options.resolveLinks) {
    return createPassthroughLinkResolver();
  }

  return createRedirectLinkResolver({
    cache: createJsonLinkCache({ filePath: options.linkCachePath }),
    logger: options.logger,
    now: options.now,
    concurrency: DEFAULT_NEWSLETTER_LINK_CONCURRENCY,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * `undefined`, not a do-nothing checker, when checking is off.
 *
 * Same reasoning as the CLI: `undefined` is the ONLY way to say "off", and a
 * second way is what once made a `--no-check-links` run report "0 checked, 0
 * reachable" - a report about a pass that never happened.
 */
function buildLinkChecker(options: QueuePipelineRunnerOptions): LinkChecker | undefined {
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

function buildSources(options: QueuePipelineRunnerOptions): readonly JobSource[] {
  const boardOptions = {
    logger: options.logger,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    now: options.now,
  };

  const factories: Readonly<Record<SelectableSourceId, () => JobSource>> = {
    fixture: () => createFixtureJobSource({ filePath: options.fixturePath, now: options.now }),

    adzuna: () => {
      const credentials = loadAdzunaCredentials();
      return createAdzunaJobSource({
        appId: credentials.appId,
        appKey: credentials.appKey,
        logger: options.logger,
        ...(credentials.baseUrl === undefined ? {} : { baseUrl: credentials.baseUrl }),
      });
    },

    manfred: () =>
      createManfredJobSource({
        logger: options.logger,
        timeoutMs: options.timeoutMs,
        concurrency: options.concurrency,
        now: options.now,
      }),

    greenhouse: () =>
      createGreenhouseJobSource({ ...boardOptions, companies: companiesFor('greenhouse') }),
    lever: () => createLeverJobSource({ ...boardOptions, companies: companiesFor('lever') }),
    ashby: () => createAshbyJobSource({ ...boardOptions, companies: companiesFor('ashby') }),
    smartrecruiters: () =>
      createSmartRecruitersJobSource({
        ...boardOptions,
        companies: companiesFor('smartrecruiters'),
      }),

    landingjobs: () =>
      createLandingJobsSource({
        logger: options.logger,
        timeoutMs: options.timeoutMs,
        now: options.now,
      }),

    arbeitnow: () =>
      createArbeitnowJobSource({
        logger: options.logger,
        timeoutMs: options.timeoutMs,
        now: options.now,
      }),

    newsletter: () =>
      createNewsletterJobSource({
        directory: options.newsletterDir,
        logger: options.logger,
        now: options.now,
        linkResolver: buildLinkResolver(options),
      }),
  };

  return options.sources.map((id) => {
    try {
      return factories[id]();
    } catch (cause: unknown) {
      options.logger.error(
        `[${id}] could not be configured: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return unavailableSource(id, cause);
    }
  });
}

export function createQueuePipelineRunner(
  options: QueuePipelineRunnerOptions,
): PipelineRunner {
  return {
    async run(): Promise<FetchRunSummary> {
      const now = options.now();
      const checker = buildLinkChecker(options);
      const candidateProfile = loadCandidateProfile();

      const queue = await buildJobQueue(
        {
          queries: DEFAULT_SEARCH_PLAN as readonly JobSourceQuery[],
          candidateName: candidateProfile.displayName,
        },
        {
          sources: buildSources(options),
          scoringConfig: DEFAULT_SCORING_CONFIG,
          juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
          logger: options.logger,
          now: () => now,
          // Spread, so an opted-out run passes NO `linkChecker` key at all
          // rather than an explicit `undefined`.
          ...(checker === undefined ? {} : { linkChecker: checker }),
        },
      );

      /*
       * Persisting is a DECISION, not a side effect. The web path goes through
       * exactly the same guard the CLI does, so a run whose sources were down
       * cannot record its emptiness over real postings - and the refusal is
       * carried into the summary rather than swallowed.
       */
      const persisted = await persistQueue(queue, {
        reader: createJsonFileQueueReader({ filePath: options.outputPath }),
        writer: createJsonFileQueueWriter({ filePath: options.outputPath }),
        logger: options.logger,
      });

      return summarizeRun(queue, persisted);
    },
  };
}
