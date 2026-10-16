import { consoleLogger } from '../adapters/logging/console-logger.js';
import { createJsonFileQueueReader } from '../adapters/output/json-file-queue-reader.js';
import { createJsonFileQueueWriter } from '../adapters/output/json-file-queue-writer.js';
import { createJsonApplicationRepository } from '../adapters/persistence/json-application-repository.js';
import {
  buildLinkChecker as buildSharedLinkChecker,
  buildSourceFactories,
  type SourceCompositionOptions,
} from '../adapters/pipeline/source-composition.js';
import { buildJobQueue } from '../app/build-job-queue.js';
import { persistQueue } from '../app/persist-queue.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadDotEnv } from '../config/env.js';
import { DEFAULT_JUNIOR_FILTER_CONFIG } from '../config/junior-filter-config.js';
import { DEFAULT_SCORING_CONFIG } from '../config/scoring-config.js';
import { DEFAULT_SEARCH_PLAN } from '../config/search-plan.js';
import type { JobSource } from '../ports/job-source.js';
import type { LinkChecker } from '../ports/link-checker.js';
import { exitCodeFor } from './exit-code.js';
import { USAGE, parseCliOptions, type CliOptions } from './options.js';
import {
  renderExcludedTable,
  renderLinkAudit,
  renderLivenessReport,
  renderRankedTable,
  renderRunSummary,
  renderSampleDataNotice,
  renderScoreExplanations,
} from './render-table.js';

/**
 * COMPOSITION ROOT.
 *
 * Wiring and printing only. Option parsing moved to `options.ts` and the
 * renderers live in `render-table.ts`, because this module calls `main()` at
 * import time - anything defined here is, by construction, untestable.
 */

interface BuiltSources {
  readonly sources: readonly JobSource[];
}

/**
 * The CLI's view of the shared source composition.
 *
 * Whether this program talks to the internet (`--no-resolve-links`,
 * `--no-check-links`) is decided here from the user's flags, then handed to the
 * shared factories rather than defaulted inside an adapter.
 */
function compositionOptions(options: CliOptions): SourceCompositionOptions {
  return {
    fixturePath: options.fixturePath,
    livenessCachePath: options.livenessCachePath,
    checkLinks: options.checkLinks,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    logger: consoleLogger,
    now: () => new Date(),
  };
}

function buildLinkChecker(options: CliOptions): LinkChecker | undefined {
  return buildSharedLinkChecker(compositionOptions(options));
}

function buildSources(options: CliOptions): BuiltSources {
  const factories = buildSourceFactories(compositionOptions(options));
  return { sources: options.sources.map((id) => factories[id]()) };
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  const options = parseCliOptions(argv);
  loadDotEnv();
  const candidateProfile = loadCandidateProfile();

  const now = new Date();
  const applicationRepository = createJsonApplicationRepository({
    filePath: options.applicationLogPath,
  });

  // A broken application log must not stop the candidate seeing today's jobs;
  // it degrades the run exactly like a dead job source does.
  const applications = await applicationRepository.list().catch((cause: unknown) => {
    consoleLogger.warn(
      `application log unavailable, showing every job as not applied: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return [];
  });

  const built = buildSources(options);
  const checker = buildLinkChecker(options);

  const queue = await buildJobQueue(
    {
      queries: DEFAULT_SEARCH_PLAN,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      candidateName: candidateProfile.displayName,
    },
    {
      sources: built.sources,
      scoringConfig: DEFAULT_SCORING_CONFIG,
      juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
      logger: consoleLogger,
      now: () => now,
      applications,
      // Spread, so an opted-out run passes NO `linkChecker` key at all rather
      // than an explicit `undefined`. Same shape as `limit` above.
      ...(checker === undefined ? {} : { linkChecker: checker }),
    },
  );

  console.log('');
  console.log(renderRunSummary(queue));
  /*
   * THE TWO HONESTY CHECKS, printed before the list rather than after it.
   *
   * Before, because they change how the list should be read, and a caveat that
   * arrives after the thing it qualifies has already been read is not a caveat.
   */
  const sampleNotice = renderSampleDataNotice(queue);
  if (sampleNotice !== null) {
    console.log('');
    console.log(sampleNotice);
  }

  const linkAudit = renderLinkAudit(queue);
  if (linkAudit !== null) {
    console.log('');
    console.log(linkAudit);
  }

  /*
   * WHAT THIS RUN DELETED. Printed before the list, with the other honesty
   * checks, for the same reason they are: it changes how the list should be
   * read, and a caveat that arrives after the thing it qualifies has already
   * been read is not a caveat.
   */
  const livenessReport = renderLivenessReport(queue);
  if (livenessReport !== null) {
    console.log('');
    console.log(livenessReport);
  }

  console.log('');
  console.log(renderRankedTable(queue));
  console.log('');
  if (options.explain > 0) {
    console.log(renderScoreExplanations(queue, options.explain));
    console.log('');
  }
  // Printed after the ranked table, never instead of it: the exclusions are an
  // audit trail the candidate is meant to read, not a hidden implementation
  // detail of the ranking.
  const exclusions = renderExcludedTable(queue);
  if (exclusions !== '') {
    console.log(exclusions);
    console.log('');
  }

  /*
   * Persisting is a DECISION, not a side effect.
   *
   * A run that learned nothing because its sources were down must not be
   * allowed to record that nothing over real postings. `persistQueue` owns that
   * judgement; everything here just renders the verdict.
   */
  const persisted = await persistQueue(queue, {
    reader: createJsonFileQueueReader({ filePath: options.outputPath }),
    writer: createJsonFileQueueWriter({ filePath: options.outputPath }),
    logger: consoleLogger,
  });

  if (persisted.status === 'refused') {
    console.log('QUEUE NOT WRITTEN - the previous queue was left exactly as it was.');
    console.log(`  ${persisted.reason}`);
    console.log('  The failed queries are listed in the run summary above.');
    console.log(
      `  Re-run once the source recovers, or pass --out=<path> to inspect a run without touching ${options.outputPath}.`,
    );
  } else {
    console.log(`Queue written to ${persisted.path}`);
    for (const warning of persisted.warnings) {
      console.log(`  note: ${warning}`);
    }
  }

  // Repeated at the very bottom: the ranked table is routinely longer than a
  // terminal screen, and the last thing on it is the last thing read.
  if (sampleNotice !== null) {
    console.log('');
    console.log(sampleNotice);
  }

  return exitCodeFor(persisted);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    consoleLogger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
