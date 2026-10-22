import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
import { SCRATCH_MAIL_PROPOSALS_PATH, SCRATCH_MAIL_RUN_STATE_PATH, SCRATCH_ROOT } from './workspace.js';

/**
 * Mail-proposal seeding and readback for the U5d specs.
 *
 * Proposals are written STRAIGHT into the isolated store (the same shape the
 * zod adapter reads), so a spec can stage the state a mail check would have
 * produced without any Gmail involvement: `JOB_QUEUE_WEB_MAIL` stays unset in
 * the server, mail is simply off, and the check/catch-up path is never armed.
 * That is enough for the confirmation modal, which acts on PENDING proposals
 * however they were created, and it keeps the suite hermetic by construction.
 *
 * Scratch tree only, like every other helper in `support/`.
 */

export interface SeedProposal {
  readonly id: string;
  readonly jobId: string;
  readonly proposedOutcome: string;
  /** Absent on proposals stored before this field existed; the adapter accepts both. */
  readonly basedOnOutcome?: string;
  readonly messageId: string;
  readonly snippet: string;
  readonly evidence?: readonly string[];
  /** ISO date. */
  readonly detectedAt: string;
  readonly status: 'pending' | 'accepted' | 'dismissed';
}

export interface StoredProposal {
  readonly id: string;
  readonly jobId: string;
  readonly proposedOutcome: string;
  readonly basedOnOutcome?: string;
  readonly messageId: string;
  readonly snippet: string;
  readonly evidence: readonly string[];
  readonly detectedAt: string;
  readonly status: 'pending' | 'accepted' | 'dismissed';
  readonly historyEntryId?: string;
}

async function writeProposals(rows: readonly SeedProposal[]): Promise<void> {
  if (!SCRATCH_MAIL_PROPOSALS_PATH.startsWith(`${SCRATCH_ROOT}${sep}`)) {
    throw new Error(`Refusing to seed outside the scratch tree: ${SCRATCH_MAIL_PROPOSALS_PATH}`);
  }
  await mkdir(dirname(SCRATCH_MAIL_PROPOSALS_PATH), { recursive: true });
  await writeFile(
    SCRATCH_MAIL_PROPOSALS_PATH,
    `${JSON.stringify(
      {
        version: 1,
        proposals: rows.map((row) => ({ evidence: [], ...row })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** Replaces the ISOLATED proposals file with exactly these rows. */
export async function seedMailProposals(rows: readonly SeedProposal[]): Promise<void> {
  await writeProposals(rows);
}

/**
 * Reads back what the SERVER wrote to the proposals file: "the modal closed"
 * and "the proposal is durably accepted" are two different claims.
 */
export async function readMailProposals(): Promise<readonly StoredProposal[]> {
  try {
    const raw = await readFile(SCRATCH_MAIL_PROPOSALS_PATH, 'utf8');
    const list = (JSON.parse(raw) as { proposals?: unknown }).proposals;
    return Array.isArray(list) ? (list as StoredProposal[]) : [];
  } catch {
    return [];
  }
}

/**
 * Writes the ISOLATED mail run state, in the adapter's own shape.
 *
 * Needed to make the check deterministic: with a recent `lastSuccessAt` the
 * on-open catch-up is not due, so the only thing that can run the check is the
 * button the spec presses. Without this a catch-up racing the click would make
 * the assertion pass for the wrong reason.
 */
export async function seedMailRunState(state: {
  readonly lastSuccessAt: string | null;
  readonly lastAttemptAt: string | null;
}): Promise<void> {
  if (!SCRATCH_MAIL_RUN_STATE_PATH.startsWith(`${SCRATCH_ROOT}${sep}`)) {
    throw new Error(`Refusing to seed outside the scratch tree: ${SCRATCH_MAIL_RUN_STATE_PATH}`);
  }
  await mkdir(dirname(SCRATCH_MAIL_RUN_STATE_PATH), { recursive: true });
  await writeFile(
    SCRATCH_MAIL_RUN_STATE_PATH,
    `${JSON.stringify(
      {
        version: 1,
        lastSuccessAt: state.lastSuccessAt,
        lastAttemptAt: state.lastAttemptAt,
        lastError: null,
        tokenIssuedAt: null,
        authFailedAt: null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
