import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from './atomic-file.js';

/**
 * The mechanics every single-file JSON log shares: read and validate, refuse to
 * overwrite what cannot be parsed, serialise read-modify-write cycles inside one
 * process, and write atomically.
 *
 * What stays in each repository is what actually differs: the entry schema, the
 * domain factory that re-mints entries, and the business rules (idempotency,
 * ordering). Two copies of this plumbing used to drift apart; each new persisted
 * field would have had to be wired through both.
 *
 * Concurrency is in-process only. A second OS process writing the same file is an
 * accepted limitation for a single-user local app.
 */

const CURRENT_VERSION = 1;

const envelopeSchema = z.object({ version: z.literal(CURRENT_VERSION) }).passthrough();

export interface JsonLogStoreOptions<Raw, Entity, Serialized> {
  readonly filePath: string;
  /** Human noun used in error messages, e.g. "application". */
  readonly label: string;
  /** Property of the file envelope that holds the entries, e.g. "applications". */
  readonly entriesKey: string;
  readonly entrySchema: z.ZodType<Raw, z.ZodTypeDef, unknown>;
  /** Re-mints a parsed entry through the domain so invariants hold for disk data. */
  readonly revive: (raw: Raw) => Entity;
  readonly serialize: (entity: Entity) => Serialized;
}

export interface JsonLogStore<Entity> {
  /** Runs one read-modify-write cycle after every earlier one has finished. */
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
  readAll(): Promise<Entity[]>;
  writeAll(entries: readonly Entity[]): Promise<void>;
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}

export function createJsonLogStore<Raw, Entity, Serialized>(
  options: JsonLogStoreOptions<Raw, Entity, Serialized>,
): JsonLogStore<Entity> {
  const target = resolve(options.filePath);
  const { label, entriesKey } = options;

  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    // The queue must survive a rejected operation, otherwise one failed write
    // would poison every later one.
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readAll(): Promise<Entity[]> {
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (cause: unknown) {
      if (isMissingFile(cause)) {
        return [];
      }
      throw cause;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new Error(
        `The ${label} log at ${target} is not valid JSON. Refusing to overwrite it - ` +
          'move the file aside if you want to start over.',
      );
    }

    const envelope = envelopeSchema.safeParse(parsedJson);
    const entries = envelope.success
      ? z.array(options.entrySchema).safeParse(envelope.data[entriesKey])
      : envelope;
    if (!entries.success) {
      throw new Error(
        `The ${label} log at ${target} does not match the expected schema: ` +
          `${entries.error.issues[0]?.message ?? 'unknown error'}. Refusing to overwrite it.`,
      );
    }

    return entries.data.map((entry) => options.revive(entry));
  }

  async function writeAll(entries: readonly Entity[]): Promise<void> {
    const payload = `${JSON.stringify(
      { version: CURRENT_VERSION, [entriesKey]: entries.map(options.serialize) },
      null,
      2,
    )}\n`;

    await writeFileAtomically(target, payload, entriesKey);
  }

  return { exclusive, readAll, writeAll };
}
