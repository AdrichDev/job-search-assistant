import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import {
  ISOLATION_ENV,
  PIPELINE_ENV,
  SCRATCH_ROOT,
  assertIsolated,
  assertOfflinePipeline,
  resetApplications,
  resetDismissals,
  resetRunState,
  resetScratch,
  seedQueue,
} from './workspace.js';

/**
 * Runs once, before anything else.
 *
 * Three jobs, in order of importance:
 *
 * 1. Prove the isolation overrides are configured. If they are not, abort
 *    before a browser ever starts - the alternative is a suite that quietly
 *    rewrites the user's job applications.
 * 2. Fingerprint the user's REAL data files, so `isolation.spec.ts` can prove
 *    afterwards that the run did not touch them. A promise of isolation that
 *    nothing verifies is just a comment.
 * 3. Give the server a known queue and an empty application log to boot with.
 */

const WORKSPACE_ROOT = resolve(SCRATCH_ROOT, '..', '..');

/** The files the app would write to if isolation failed. */
export const REAL_USER_FILES: readonly string[] = [
  resolve(WORKSPACE_ROOT, 'output', 'queue.json'),
  resolve(WORKSPACE_ROOT, 'data', 'applications.json'),
  // Added with the dismissal feature. Fingerprinted even though it may not
  // exist yet: `<absent>` is a state worth proving unchanged too, because the
  // failure being guarded is a suite that CREATES it.
  resolve(WORKSPACE_ROOT, 'data', 'dismissals.json'),
  resolve(WORKSPACE_ROOT, 'data', '.fetch-run.json'),
];

export const BASELINE_PATH = resolve(SCRATCH_ROOT, 'real-file-baseline.json');

export interface FileFingerprint {
  readonly path: string;
  /** `null` when the file does not exist - itself a state worth preserving. */
  readonly sha256: string | null;
  readonly size: number | null;
  readonly modifiedMs: number | null;
}

export async function fingerprint(path: string): Promise<FileFingerprint> {
  try {
    const [buffer, stat] = await Promise.all([
      readFile(path),
      import('node:fs/promises').then((fs) => fs.stat(path)),
    ]);
    return {
      path,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      size: stat.size,
      modifiedMs: stat.mtimeMs,
    };
  } catch {
    return { path, sha256: null, size: null, modifiedMs: null };
  }
}

async function globalSetup(): Promise<void> {
  assertIsolated(ISOLATION_ENV);
  // The second guarantee: pressing the fetch button in a spec must not reach
  // the public internet. Checked here, before a browser exists.
  assertOfflinePipeline(PIPELINE_ENV);

  await resetScratch();

  const baseline = await Promise.all(REAL_USER_FILES.map(fingerprint));
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

  await seedQueue(HEALTHY_QUEUE);
  await resetApplications();
  await resetDismissals();
  await resetRunState();

  for (const entry of baseline) {
    // Printed so the guarantee is visible in the run log, not only in an
    // assertion nobody reads when the suite is green.
    process.stdout.write(
      `[e2e] baseline ${entry.path}: ${entry.sha256 ?? '<absent>'}\n`,
    );
  }
}

export default globalSetup;
