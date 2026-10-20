import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from './atomic-file.js';
import {
  EMPTY_MAIL_RUN_STATE,
  type MailRunState,
  type MailRunStateStore,
} from '../../ports/mail-run-state-store.js';

/**
 * The mail run state on disk: one small JSON object, written atomically.
 *
 * Unlike the fetch run's status board, a corrupt file is REFUSED, not reset: it
 * holds the token issue date and the last success, and silently replacing it
 * would hide the 7-day alert and trigger a needless catch-up. The user moves the
 * file aside to start over. A missing file is simply the empty state.
 *
 * Concurrency is in-process only, like the other JSON stores.
 */

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'not an ISO date')
  .nullable();

const fileSchema = z
  .object({
    version: z.literal(1),
    lastSuccessAt: isoDate,
    lastAttemptAt: isoDate,
    lastError: z.string().nullable(),
    tokenIssuedAt: isoDate,
    authFailedAt: isoDate,
  })
  .strict();

export interface JsonMailRunStateStoreOptions {
  readonly filePath: string;
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  );
}

export function createJsonMailRunStateStore(
  options: JsonMailRunStateStoreOptions,
): MailRunStateStore {
  const target = resolve(options.filePath);
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readState(): Promise<MailRunState> {
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (cause: unknown) {
      if (isMissingFile(cause)) {
        return EMPTY_MAIL_RUN_STATE;
      }
      throw cause;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(
        `The mail run state at ${target} is not valid JSON. Refusing to overwrite it - ` +
          'move the file aside if you want to start over.',
      );
    }

    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `The mail run state at ${target} does not match the expected schema: ` +
          `${parsed.error.issues[0]?.message ?? 'unknown error'}. Refusing to overwrite it.`,
      );
    }

    const { version: _version, ...state } = parsed.data;
    return state;
  }

  async function writeState(state: MailRunState): Promise<void> {
    const payload = `${JSON.stringify(
      {
        version: 1,
        lastSuccessAt: state.lastSuccessAt,
        lastAttemptAt: state.lastAttemptAt,
        lastError: state.lastError,
        tokenIssuedAt: state.tokenIssuedAt,
        authFailedAt: state.authFailedAt,
      },
      null,
      2,
    )}\n`;
    await writeFileAtomically(target, payload, 'mail-run');
  }

  return {
    read: () => exclusive(readState),

    write: (state) =>
      exclusive(async () => {
        // A corrupt file must stay untouched even for a full replacement.
        await readState();
        await writeState(state);
      }),

    update: (change) =>
      exclusive(async () => {
        const next = change(await readState());
        await writeState(next);
        return next;
      }),
  };
}
