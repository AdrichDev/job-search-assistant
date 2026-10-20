import 'server-only';

import {
  DEFAULT_APPLICATION_LOG_PATH,
  DEFAULT_DISMISSAL_LOG_PATH,
  DEFAULT_FIXTURE_PATH,
  DEFAULT_HISTORY_LOG_PATH,
  DEFAULT_JUNIOR_FILTER_CONFIG,
  DEFAULT_QUEUE_PATH,
  DEFAULT_RUN_STATE_PATH,
  DEFAULT_SCORING_CONFIG,
  DEFAULT_SEARCH_PLAN,
  buildJobQueue,
  consoleLogger,
  createFixtureJobSource,
  createJsonApplicationHistoryRepository,
  createJsonApplicationRepository,
  createJsonDismissalRepository,
  createJsonFileQueueReader,
  createJsonRunStateStore,
  loadCandidateProfile,
  type ApplicationHistoryRepository,
  type ApplicationRepository,
  type DismissalRepository,
  type JobQueue,
  type QueueReader,
  type RunStateStore,
} from '@job-queue/core';

/**
 * Composition root for the web app's READ and TRACKING paths.
 *
 * `server-only` makes an accidental client import a BUILD error rather than a
 * runtime surprise - this module reaches into the filesystem and must never be
 * bundled for the browser.
 *
 * No API keys are read here, and that is still deliberate. Everything wired in
 * this module - the queue reader, the application log, the dismissal log, the
 * run's status board - works against files on disk and needs no credential, so
 * the render path cannot leak one even by accident.
 *
 * The one thing that DOES need credentials, the fetch pipeline, lives in
 * `server/pipeline.ts` instead. Keeping it in a separate module is not
 * decoration: it means this file's guarantee stays literally true, and a reader
 * checking "can a credential reach the browser?" has one small module to audit
 * rather than a mixed one.
 */

let repository: ApplicationRepository | null = null;
let history: ApplicationHistoryRepository | null = null;
let dismissals: DismissalRepository | null = null;
let reader: QueueReader | null = null;
let runState: RunStateStore | null = null;

export function applicationRepository(): ApplicationRepository {
  repository ??= createJsonApplicationRepository({ filePath: DEFAULT_APPLICATION_LOG_PATH });
  return repository;
}

/**
 * Append-only change history of applications. A singleton for the same reason as
 * the application log: its adapter serialises appends through one in-process queue.
 */
export function applicationHistoryRepository(): ApplicationHistoryRepository {
  history ??= createJsonApplicationHistoryRepository({ filePath: DEFAULT_HISTORY_LOG_PATH });
  return history;
}

/**
 * Offers the human said no to.
 *
 * A module-level singleton like the others, and here that matters more than
 * elsewhere: the JSON adapter serializes its read-modify-write cycles through
 * an in-process promise queue, and two instances would each have their own
 * queue and could lose a row to a race.
 */
export function dismissalRepository(): DismissalRepository {
  dismissals ??= createJsonDismissalRepository({ filePath: DEFAULT_DISMISSAL_LOG_PATH });
  return dismissals;
}

export function queueReader(): QueueReader {
  reader ??= createJsonFileQueueReader({ filePath: DEFAULT_QUEUE_PATH });
  return reader;
}

/**
 * The fetch run's status board and single-flight lock.
 *
 * Singleton for the same reason as above, and for one more: its in-process
 * serialization is what makes two clicks in the SAME server process race-free
 * without relying on the filesystem-level lock alone.
 */
export function runStateStore(): RunStateStore {
  runState ??= createJsonRunStateStore({ filePath: DEFAULT_RUN_STATE_PATH });
  return runState;
}

/**
 * Offline fallback so the first launch is never an empty screen.
 *
 * Uses the committed fixture catalogue: no network, no API key, deterministic.
 *
 * IMPORTANT, and surfaced to the user rather than hidden here: these postings
 * are invented sample data and their URLs point at `example-board.test`, which
 * does not resolve. The page labels this state loudly for exactly that reason -
 * a screen of plausible-looking offers with dead apply buttons is precisely the
 * failure this codebase is paying down.
 *
 * No `limit`: the candidate asked to see every offer that passes the filters.
 */
export async function buildFallbackQueue(now: Date): Promise<JobQueue> {
  const candidateProfile = loadCandidateProfile();

  return buildJobQueue(
    {
      queries: DEFAULT_SEARCH_PLAN,
      candidateName: candidateProfile.displayName,
    },
    {
      sources: [createFixtureJobSource({ filePath: DEFAULT_FIXTURE_PATH, now: () => now })],
      scoringConfig: DEFAULT_SCORING_CONFIG,
      juniorFilterConfig: DEFAULT_JUNIOR_FILTER_CONFIG,
      logger: consoleLogger,
      now: () => now,
    },
  );
}
