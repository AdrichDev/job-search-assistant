import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared on-disk locations.
 *
 * `data/` and `output/` live at the WORKSPACE root, not inside a package,
 * because both the CLI (packages/core) and the web app (apps/web) read and
 * write the same files. Resolving them relative to a package directory would
 * silently give each workspace its own private copy of the application log.
 */

function hasWorkspaceManifest(directory: string): boolean {
  const manifest = resolve(directory, 'package.json');
  if (!existsSync(manifest)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as { workspaces?: unknown }).workspaces)
    );
  } catch {
    // A package.json we cannot parse is not the root we are looking for.
    return false;
  }
}

/**
 * Walks up from `startDirectory` until it finds the package.json that declares
 * npm workspaces.
 *
 * Falls back to `startDirectory` rather than throwing: a missing marker must
 * degrade into "use local paths", never into a crashed process.
 */
export function findWorkspaceRoot(startDirectory: string): string {
  let current = resolve(startDirectory);

  for (;;) {
    if (hasWorkspaceManifest(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(startDirectory);
    }
    current = parent;
  }
}

/** Workspace root resolved once, from this module's own location. */
export const WORKSPACE_ROOT = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Environment override for a shared on-disk location.
 *
 * Exists for exactly one reason: a process that boots the real app must be able
 * to be pointed at a scratch directory. The E2E suite drives the actual Next
 * server, clicks the actual Apply button and therefore performs actual writes -
 * against the defaults below, that would append to the human's own application
 * history and could destroy a real queue. Isolation has to be possible from
 * OUTSIDE the app, without a test-only code path inside it, so it lives here in
 * production code next to the values it overrides.
 *
 * Blank is treated as absent: an unset variable and one exported as "" mean the
 * same thing to a shell, and silently resolving "" to the process CWD would put
 * the application log somewhere nobody asked for.
 *
 * `env` is a parameter rather than a direct `process.env` read so the rule is
 * testable without mutating global state.
 */
export function resolveDataPath(
  variable: string,
  fallback: string,
  env: Readonly<Partial<Record<string, string>>> = process.env,
): string {
  const raw = env[variable];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  return resolve(raw.trim());
}

export const DEFAULT_FIXTURE_PATH = resolveDataPath(
  'JOB_QUEUE_FIXTURE_PATH',
  resolve(WORKSPACE_ROOT, 'data/sample-jobs.json'),
);

export const DEFAULT_QUEUE_PATH = resolveDataPath(
  'JOB_QUEUE_QUEUE_PATH',
  resolve(WORKSPACE_ROOT, 'output/queue.json'),
);

export const DEFAULT_APPLICATION_LOG_PATH = resolveDataPath(
  'JOB_QUEUE_APPLICATIONS_PATH',
  resolve(WORKSPACE_ROOT, 'data/applications.json'),
);

/**
 * Offers the human said no to.
 *
 * A sibling of the application log rather than a column inside it, because the
 * two answer different questions and have different lifetimes: an application is
 * permanent history with an outcome attached, a dismissal is a preference that
 * can be taken back. Folding them together would make "restore" mean "delete a
 * row from the history file", which is the operation this codebase refuses.
 */
export const DEFAULT_DISMISSAL_LOG_PATH = resolveDataPath(
  'JOB_QUEUE_DISMISSALS_PATH',
  resolve(WORKSPACE_ROOT, 'data/dismissals.json'),
);

/**
 * The fetch run's status board and its single-flight lock.
 *
 * Dot-prefixed because, unlike the two logs above, nothing here is the human's
 * data: it is transient state about the last run, safe to delete, and rebuilt by
 * the next one.
 */
export const DEFAULT_RUN_STATE_PATH = resolveDataPath(
  'JOB_QUEUE_RUN_STATE_PATH',
  resolve(WORKSPACE_ROOT, 'data/.fetch-run.json'),
);

/**
 * Append-only change history of applications. Personal (it quotes notes), so it
 * is git-ignored like the logs above, and relocatable for the same reason.
 */
export const DEFAULT_HISTORY_LOG_PATH = resolveDataPath(
  'JOB_QUEUE_HISTORY_PATH',
  resolve(WORKSPACE_ROOT, 'data/application-history.json'),
);
