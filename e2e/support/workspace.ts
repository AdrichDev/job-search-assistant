import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QueueFile } from '../fixtures/queue.js';

/**
 * Where an E2E run is allowed to write.
 *
 * This module exists because of a hazard that is bigger than any bug this suite
 * can catch: the app under test writes to `data/applications.json` and reads
 * `output/queue.json` at the WORKSPACE ROOT. Those are the human's real files -
 * their actual job applications and their actual last pipeline run. A browser
 * test that clicks "Aplicar" performs a real write.
 *
 * So the suite never runs against the defaults. `playwright.config.ts` exports
 * the two override variables below into the server process, which resolves them
 * through `resolveDataPath` in `@job-queue/core`. Every path this module hands
 * out lives under `e2e/.tmp/`, which is gitignored and wiped between runs.
 *
 * If these variables were ever dropped, the suite would silently start editing
 * the user's history. That is why `assertIsolated` is called from the global
 * setup and hard-fails rather than warning.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Root of the scratch area. Nothing outside this tree may be written. */
export const SCRATCH_ROOT = resolve(HERE, '..', '.tmp');

/** Stands in for the user's `output/queue.json`. */
export const SCRATCH_QUEUE_PATH = resolve(SCRATCH_ROOT, 'output', 'queue.json');

/** Stands in for the user's `data/applications.json`. */
export const SCRATCH_APPLICATIONS_PATH = resolve(SCRATCH_ROOT, 'data', 'applications.json');

/** Stands in for the user's `data/dismissals.json`. */
export const SCRATCH_DISMISSALS_PATH = resolve(SCRATCH_ROOT, 'data', 'dismissals.json');

/** Stands in for the user's `data/application-history.json`. */
export const SCRATCH_HISTORY_PATH = resolve(SCRATCH_ROOT, 'data', 'application-history.json');

/** Stands in for the user's `data/.fetch-run.json` and its lock. */
export const SCRATCH_RUN_STATE_PATH = resolve(SCRATCH_ROOT, 'data', 'fetch-run.json');

/** Stands in for the user's `data/.mail-run.json`. */
export const SCRATCH_MAIL_RUN_STATE_PATH = resolve(SCRATCH_ROOT, 'data', 'mail-run.json');

/** Stands in for the user's `data/mail-proposals.json`. */
export const SCRATCH_MAIL_PROPOSALS_PATH = resolve(SCRATCH_ROOT, 'data', 'mail-proposals.json');

/**
 * Stands in for the user's CV folder (`data/cv-library`, or wherever they point
 * `JOB_QUEUE_CV_LIBRARY_DIR`). Holds ONLY synthetic tiny PDFs the suite creates;
 * the user's real folder is never read, listed or touched by a spec.
 */
export const SCRATCH_CV_LIBRARY_DIR = resolve(SCRATCH_ROOT, 'cv-library');

/** Stands in for the user's `data/cv-models.json` (the registry of models). */
export const SCRATCH_CV_MODELS_PATH = resolve(SCRATCH_ROOT, 'data', 'cv-models.json');

/** The variables `@job-queue/core` reads to relocate its shared files. */
export const ISOLATION_ENV: Readonly<Record<string, string>> = {
  JOB_QUEUE_QUEUE_PATH: SCRATCH_QUEUE_PATH,
  JOB_QUEUE_APPLICATIONS_PATH: SCRATCH_APPLICATIONS_PATH,
  JOB_QUEUE_DISMISSALS_PATH: SCRATCH_DISMISSALS_PATH,
  JOB_QUEUE_HISTORY_PATH: SCRATCH_HISTORY_PATH,
  JOB_QUEUE_RUN_STATE_PATH: SCRATCH_RUN_STATE_PATH,
  JOB_QUEUE_MAIL_RUN_STATE_PATH: SCRATCH_MAIL_RUN_STATE_PATH,
  JOB_QUEUE_MAIL_PROPOSALS_PATH: SCRATCH_MAIL_PROPOSALS_PATH,
  JOB_QUEUE_CV_LIBRARY_DIR: SCRATCH_CV_LIBRARY_DIR,
  JOB_QUEUE_CV_MODELS_PATH: SCRATCH_CV_MODELS_PATH,
};

/**
 * The pipeline knobs, and the reason this suite may press "Buscar ofertas".
 *
 * A fetch run against the defaults is roughly 137 HTTP requests aimed at real
 * employers' careers servers. A browser test suite must never do that: it is
 * rude, it is slow, it is non-deterministic, and it is squarely against this
 * project's standing rule about how it treats third-party job boards.
 *
 * So the runner is pointed at the committed offline catalogue and the liveness
 * check is switched off. What runs is still the REAL pipeline - the real two
 * filters, the real dedupe, the real `persistQueue` guard, the real state
 * machine - with a source that reads a local JSON file. That is injection at
 * the port boundary, not a mock of the feature under test.
 *
 * `example-board.test` is a reserved TLD that resolves nowhere, so even a
 * regression that re-enabled link checking could not reach a real host.
 */
export const PIPELINE_ENV: Readonly<Record<string, string>> = {
  JOB_QUEUE_WEB_SOURCES: 'fixture',
  JOB_QUEUE_WEB_CHECK_LINKS: '0',
  JOB_QUEUE_WEB_RESOLVE_LINKS: '0',
};

/**
 * Refuses to run unless both overrides point inside the scratch tree.
 *
 * A guard, not a formality. The failure mode it prevents - a run that appends
 * to the real application log - is silent, destructive and only noticed later.
 */
export function assertIsolated(env: Readonly<Partial<Record<string, string>>>): void {
  for (const [name, expected] of Object.entries(ISOLATION_ENV)) {
    const actual = env[name];
    if (actual === undefined || resolve(actual) !== expected) {
      throw new Error(
        `E2E isolation broken: ${name} is ${actual ?? '<unset>'} but must be ${expected}. ` +
          'Refusing to run - without this override the suite writes to the real ' +
          'output/queue.json, data/applications.json or data/dismissals.json.',
      );
    }
  }
}

/**
 * Refuses to run unless the fetch button is pointed at the offline catalogue.
 *
 * Separate from the path check above because it fails differently and worse: a
 * dropped path override corrupts the user's files, a dropped source override
 * puts a browser test on the public internet. Both are silent, so both abort
 * before a browser starts.
 */
export function assertOfflinePipeline(env: Readonly<Partial<Record<string, string>>>): void {
  for (const [name, expected] of Object.entries(PIPELINE_ENV)) {
    const actual = env[name];
    if (actual !== expected) {
      throw new Error(
        `E2E network guard broken: ${name} is ${actual ?? '<unset>'} but must be ${expected}. ` +
          'Refusing to run - without this override, pressing "Buscar ofertas" in a test ' +
          "would issue ~137 real HTTP requests against employers' servers.",
      );
    }
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Replaces the queue the server will read on the next request. */
export async function seedQueue(queue: QueueFile): Promise<void> {
  await writeJson(SCRATCH_QUEUE_PATH, queue);
}

/** Removes the queue file entirely, which is the app's "no run yet" state. */
export async function removeQueue(): Promise<void> {
  await rm(SCRATCH_QUEUE_PATH, { force: true });
}

/**
 * Empties the application log.
 *
 * Written as an explicit empty log rather than deleted, so a test that asserts
 * "exactly one application" is measuring this run and not a leftover file.
 */
export async function resetApplications(): Promise<void> {
  await writeJson(SCRATCH_APPLICATIONS_PATH, { version: 1, applications: [] });
}

/** One application as it is stored in the log (ISO dates), without going through the app. */
export interface SeedApplication {
  readonly jobId: string;
  readonly appliedAt: string;
  readonly cvVariant?: string;
  /** References to registry models (T3b). Absent on legacy and imported rows. */
  readonly cvModelId?: string;
  readonly letterModelId?: string;
  readonly scoreAtApply?: number;
  readonly sourceIds?: readonly string[];
  readonly outcome: string;
  readonly outcomeUpdatedAt?: string;
  readonly notes?: string;
  readonly listing?: Readonly<Record<string, string>>;
}

/**
 * Writes applications INTO THE ISOLATED log, replacing its content.
 *
 * Specs otherwise only get applications by clicking "Aplicar", which can never
 * produce imported history. The target is the scratch path constant only, and
 * the path is re-checked against the scratch root so a future edit cannot point
 * this helper at the user's real `data/applications.json`.
 */
export async function seedApplications(rows: readonly SeedApplication[]): Promise<void> {
  if (!resolve(SCRATCH_APPLICATIONS_PATH).startsWith(`${SCRATCH_ROOT}${sep}`)) {
    throw new Error(`Refusing to seed outside the scratch tree: ${SCRATCH_APPLICATIONS_PATH}`);
  }
  await writeJson(SCRATCH_APPLICATIONS_PATH, {
    version: 1,
    applications: rows.map((row) => ({
      sourceIds: [],
      outcomeUpdatedAt: row.appliedAt,
      ...row,
    })),
  });
}

export interface RecordedApplication {
  readonly jobId: string;
  readonly appliedAt: string;
  readonly cvVariant?: string;
  readonly cvModelId?: string;
  readonly letterModelId?: string;
  readonly scoreAtApply?: number;
  readonly outcome: string;
  readonly outcomeUpdatedAt: string;
  readonly notes?: string;
}

/**
 * Reads back what the SERVER wrote.
 *
 * Deliberately re-reads the file instead of trusting the screen: "the UI says
 * applied" and "an application was durably recorded" are two different claims,
 * and the second is the one the user cares about.
 */
export async function readApplications(): Promise<readonly RecordedApplication[]> {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(SCRATCH_APPLICATIONS_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { applications?: unknown }).applications;
    return Array.isArray(list) ? (list as RecordedApplication[]) : [];
  } catch {
    return [];
  }
}

export interface RecordedDismissal {
  readonly jobId: string;
  readonly dismissedAt: string;
  readonly title: string;
  readonly company: string;
}

/**
 * Reads back what the SERVER wrote to the dismissal log.
 *
 * Same reasoning as `readApplications`: "the card disappeared" and "a dismissal
 * was durably recorded" are two different claims, and only the second survives a
 * reload.
 */
export async function readDismissals(): Promise<readonly RecordedDismissal[]> {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(SCRATCH_DISMISSALS_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const list = (parsed as { dismissals?: unknown }).dismissals;
    return Array.isArray(list) ? (list as RecordedDismissal[]) : [];
  } catch {
    return [];
  }
}

/** One change-history entry as it is stored (ISO date), read back without going through the app. */
export interface RecordedChange {
  readonly id: string;
  readonly jobId: string;
  readonly at: string;
  readonly source: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before: string | readonly string[] | null;
    readonly after: string | readonly string[] | null;
  }[];
  readonly revertsId?: string;
}

/**
 * Reads back the change history the SERVER wrote (oldest first, file order).
 *
 * Same reasoning as `readApplications`: "the table shows an entry" and "an entry
 * was durably appended" are two different claims. A missing file is an empty history.
 */
export async function readHistory(): Promise<readonly RecordedChange[]> {
  const { readFile } = await import('node:fs/promises');
  try {
    const raw = await readFile(SCRATCH_HISTORY_PATH, 'utf8');
    const list = (JSON.parse(raw) as { changes?: unknown }).changes;
    return Array.isArray(list) ? (list as RecordedChange[]) : [];
  } catch {
    return [];
  }
}

/** Removes the history file (the app's "no change logged yet" state). Scratch tree only. */
export async function resetHistory(): Promise<void> {
  if (!resolve(SCRATCH_HISTORY_PATH).startsWith(`${SCRATCH_ROOT}${sep}`)) {
    throw new Error(`Refusing to reset outside the scratch tree: ${SCRATCH_HISTORY_PATH}`);
  }
  await rm(SCRATCH_HISTORY_PATH, { force: true });
}

/**
 * Overwrites the ISOLATED history file with exact text (e.g. a corrupt file, or
 * entries written by hand). Scratch tree only.
 */
export async function writeHistoryFile(content: string): Promise<void> {
  if (!resolve(SCRATCH_HISTORY_PATH).startsWith(`${SCRATCH_ROOT}${sep}`)) {
    throw new Error(`Refusing to write outside the scratch tree: ${SCRATCH_HISTORY_PATH}`);
  }
  await mkdir(dirname(SCRATCH_HISTORY_PATH), { recursive: true });
  await writeFile(SCRATCH_HISTORY_PATH, content, 'utf8');
}

/** Empties the dismissal log, so a count is about this test and not a leftover. */
export async function resetDismissals(): Promise<void> {
  await writeJson(SCRATCH_DISMISSALS_PATH, { version: 1, dismissals: [] });
}

/**
 * Clears the run state AND its lock.
 *
 * The lock especially: a spec that leaves one behind would make every later
 * fetch spec see "already running" for fifteen minutes.
 */
export async function resetRunState(): Promise<void> {
  await rm(SCRATCH_RUN_STATE_PATH, { force: true });
  await rm(`${SCRATCH_RUN_STATE_PATH}.lock`, { force: true });
}

/** Wipes the whole scratch tree. Called once before the suite starts. */
export async function resetScratch(): Promise<void> {
  await rm(SCRATCH_ROOT, { recursive: true, force: true });
  await mkdir(SCRATCH_ROOT, { recursive: true });
}
