import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonFileQueueWriter } from '../../src/adapters/output/json-file-queue-writer.js';
import type { JobQueue } from '../../src/ports/queue-writer.js';
import { REFERENCE_NOW } from '../helpers/make-job.js';

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'job-queue-'));
  created.push(dir);
  return dir;
}

const QUEUE: JobQueue = {
  generatedAt: REFERENCE_NOW.toISOString(),
  candidate: 'Alex Example',
  totalFetched: 1,
  totalUnique: 1,
  totalRelevant: 1,
  totalJuniorEligible: 1,
  excluded: [],
  duplicatesRemoved: 0,
  sourceReports: [],
  jobs: [],
};

describe('createJsonFileQueueWriter', () => {
  it('writes the queue as pretty JSON and returns the path', async () => {
    const dir = await tempDir();
    const target = join(dir, 'queue.json');

    const written = await createJsonFileQueueWriter({ filePath: target }).write(QUEUE);

    expect(written).toBe(target);
    const parsed = JSON.parse(await readFile(target, 'utf8')) as JobQueue;
    expect(parsed.generatedAt).toBe(QUEUE.generatedAt);
    expect(parsed.candidate).toBe('Alex Example');
  });

  it('creates missing parent directories', async () => {
    const dir = await tempDir();
    const target = join(dir, 'nested', 'deeper', 'queue.json');

    await createJsonFileQueueWriter({ filePath: target }).write(QUEUE);

    await expect(readFile(target, 'utf8')).resolves.toContain('generatedAt');
  });

  it('overwrites a previous run', async () => {
    const dir = await tempDir();
    const target = join(dir, 'queue.json');
    const writer = createJsonFileQueueWriter({ filePath: target });

    await writer.write(QUEUE);
    await writer.write({ ...QUEUE, totalUnique: 42 });

    const parsed = JSON.parse(await readFile(target, 'utf8')) as JobQueue;
    expect(parsed.totalUnique).toBe(42);
  });
});
