import { buildJobQueue } from '../../app/build-job-queue.js';
import { persistQueue } from '../../app/persist-queue.js';
import { summarizeRun } from '../../app/summarize-run.js';
import { loadCandidateProfile } from '../../config/candidate-profile.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../../config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../../config/scoring-config.js';
import { DEFAULT_SEARCH_PLAN } from '../../config/search-plan.js';
import type { SelectableSourceId } from '../../cli/source-selection.js';
import type { JobSource, JobSourceQuery } from '../../ports/job-source.js';
import type { PipelineRunner } from '../../ports/pipeline-runner.js';
import type { FetchRunSummary } from '../../ports/run-state-store.js';
import { createJsonFileQueueReader } from '../output/json-file-queue-reader.js';
import { createJsonFileQueueWriter } from '../output/json-file-queue-writer.js';
import {
  buildLinkChecker,
  buildSourceFactories,
  type SourceCompositionOptions,
} from './source-composition.js';

/**
 * One whole ingestion run, packaged behind `PipelineRunner`.
 *
 * This is the composition the CLI performs in `cli/main.ts`, extracted so a
 * second caller - the web app's fetch button - can perform the identical run
 * without React learning what a job board is. Same sources, same two filters,
 * same liveness rule, and critically the same `persistQueue` guard, so the
 * button cannot overwrite a good queue with a broken run's emptiness.
 *
 * The source factory table now lives in `source-composition.ts` and is shared
 * with `cli/main.ts`. The CLI is deliberately NOT folded onto this runner because
 * it renders the terminal report sections.
 */

export interface QueuePipelineRunnerOptions extends SourceCompositionOptions {
  readonly sources: readonly SelectableSourceId[];
  readonly outputPath: string;
}

/**
 * A source that exists only to fail on demand.
 *
 * Used when a source cannot even be CONSTRUCTED - in practice, a search provider with no
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

function buildSources(options: QueuePipelineRunnerOptions): readonly JobSource[] {
  const factories = buildSourceFactories(options);

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
