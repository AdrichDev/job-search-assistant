import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Cross-process write safety.
 *
 * The application log, the queue and the caches are all single JSON files written
 * through one store. Before this change the only serialisation was a per-process
 * promise queue, so a CLI run and the web app could interleave a read and a write
 * and silently lose one of them. These tests run REAL second processes on purpose:
 * an in-process test cannot see the bug at all.
 */

const WRITER = resolve(import.meta.dirname, '../../fixtures/concurrent-writer.ts');

/** Node must load TypeScript sources the same way the test runner does. */
const NODE_ARGS = ['--import', 'tsx'];

interface SpawnResult {
  readonly code: number | null;
  readonly stderr: string;
}

function runWriter(filePath: string, writerId: string, iterations: number): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [...NODE_ARGS, WRITER, filePath, writerId, String(iterations)], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolvePromise({ code, stderr });
    });
  });
}

interface Envelope {
  readonly applications: readonly { readonly id: string }[];
}

async function readEntries(filePath: string): Promise<string[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as Envelope;
  return parsed.applications.map((entry) => entry.id);
}

const scratchDirectories: string[] = [];

async function scratchFile(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'job-queue-lock-'));
  scratchDirectories.push(directory);
  return join(directory, name);
}

afterEach(async () => {
  await Promise.all(
    scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('cross-process writes to one store', () => {
  it('loses no update when two processes interleave read-modify-write cycles', async () => {
    const filePath = await scratchFile('applications.json');
    const iterations = 15;

    const [first, second] = await Promise.all([
      runWriter(filePath, 'a', iterations),
      runWriter(filePath, 'b', iterations),
    ]);

    expect(first.code, first.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);

    const ids = await readEntries(filePath);
    expect(ids).toHaveLength(iterations * 2);
    expect(new Set(ids).size).toBe(iterations * 2);
    for (let i = 0; i < iterations; i += 1) {
      expect(ids).toContain(`a-${i}`);
      expect(ids).toContain(`b-${i}`);
    }
  }, 120_000);
});
