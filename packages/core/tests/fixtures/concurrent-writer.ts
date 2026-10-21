/**
 * Child-process writer used by the cross-process lock tests.
 *
 * Each iteration is one full read-modify-write cycle through the real store, with
 * a deliberate pause between the read and the write so the race window is wide
 * enough to be reproducible on a fast machine. Without a cross-process lock two
 * of these lose updates; with one, none may be lost.
 *
 * Usage: node --import tsx concurrent-writer.ts <filePath> <writerId> <iterations>
 */
import { z } from 'zod';
import { createJsonLogStore } from '../../src/adapters/persistence/json-log-store.js';

const [filePath, writerId, rawIterations] = process.argv.slice(2);

if (filePath === undefined || writerId === undefined || rawIterations === undefined) {
  process.stderr.write('usage: concurrent-writer.ts <filePath> <writerId> <iterations>\n');
  process.exit(64);
}

const iterations = Number(rawIterations);
if (!Number.isInteger(iterations) || iterations <= 0) {
  process.stderr.write(`invalid iteration count: ${rawIterations}\n`);
  process.exit(64);
}

interface Entry {
  readonly id: string;
}

const store = createJsonLogStore<Entry, Entry, Entry>({
  filePath,
  label: 'application',
  entriesKey: 'applications',
  entrySchema: z.object({ id: z.string() }),
  revive: (raw) => raw,
  serialize: (entity) => entity,
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

for (let i = 0; i < iterations; i += 1) {
  await store.exclusive(async () => {
    const existing = await store.readAll();
    await sleep(1);
    await store.writeAll([...existing, { id: `${writerId}-${i}` }]);
  });
}
