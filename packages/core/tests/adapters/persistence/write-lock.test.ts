import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  STALE_AFTER_MS,
  WRITE_LOCK_FILE_NAME,
  withWriteLock,
} from '../../../src/adapters/persistence/write-lock.js';

const HOLDER = resolve(import.meta.dirname, '../../fixtures/lock-holder.ts');
const NODE_ARGS = ['--import', 'tsx'];

const scratchDirectories: string[] = [];

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'job-queue-writelock-'));
  scratchDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

interface HolderHandle {
  readonly child: ReturnType<typeof spawn>;
  readonly held: Promise<void>;
}

function startHolder(directory: string, holdMs: number): HolderHandle {
  const child = spawn(process.execPath, [...NODE_ARGS, HOLDER, directory, String(holdMs)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const held = new Promise<void>((resolveHeld, rejectHeld) => {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (chunk.includes('held')) resolveHeld();
    });
    child.on('error', rejectHeld);
    child.on('close', () => rejectHeld(new Error('lock holder exited before taking the lock')));
  });
  return { child, held };
}

async function stopHolder(handle: HolderHandle): Promise<void> {
  handle.child.kill();
  await new Promise<void>((resolveStop) => {
    if (handle.child.exitCode !== null) {
      resolveStop();
      return;
    }
    handle.child.on('close', () => resolveStop());
  });
}

describe('write lock', () => {
  it('runs the operation and leaves no lock file behind', async () => {
    const directory = await scratch();

    const result = await withWriteLock(directory, async () => 'done');

    expect(result).toBe('done');
    expect(await readdir(directory)).not.toContain(WRITE_LOCK_FILE_NAME);
  });

  it('releases the lock when the operation throws', async () => {
    const directory = await scratch();

    await expect(
      withWriteLock(directory, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await readdir(directory)).not.toContain(WRITE_LOCK_FILE_NAME);
    await expect(withWriteLock(directory, async () => 'after')).resolves.toBe('after');
  });

  it('recovers a lock left behind by a process that is gone', async () => {
    const directory = await scratch();

    // A real dead pid: this child exits before we read its number.
    const deadPid = await new Promise<number>((resolvePid, rejectPid) => {
      const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
      child.on('close', () => {
        if (typeof child.pid === 'number') resolvePid(child.pid);
        else rejectPid(new Error('child had no pid'));
      });
    });

    await writeFile(
      join(directory, WRITE_LOCK_FILE_NAME),
      `${JSON.stringify({ pid: deadPid, startedAt: Date.now() })}\n`,
      'utf8',
    );

    await expect(withWriteLock(directory, async () => 'recovered', { waitMs: 1_000 })).resolves.toBe(
      'recovered',
    );
  });

  it('recovers a lock that is older than the staleness horizon', async () => {
    const directory = await scratch();

    // Alive pid (ours), ancient mtime: only the age can justify recovery.
    await writeFile(
      join(directory, WRITE_LOCK_FILE_NAME),
      `${JSON.stringify({ pid: process.pid, startedAt: Date.now() - STALE_AFTER_MS * 2 })}\n`,
      'utf8',
    );

    await expect(
      withWriteLock(directory, async () => 'recovered', {
        waitMs: 1_000,
        now: () => Date.now() + STALE_AFTER_MS * 3,
      }),
    ).resolves.toBe('recovered');
  });

  it('fails with an actionable message when a live process holds the lock', async () => {
    const directory = await scratch();
    const holder = startHolder(directory, 5_000);

    try {
      await holder.held;
      await expect(withWriteLock(directory, async () => 'never', { waitMs: 200 })).rejects.toThrow(
        /is writing to .*Refusing to write without the lock/,
      );
    } finally {
      await stopHolder(holder);
    }
  }, 60_000);

  it('does not deadlock when the same process re-enters the lock for one directory', async () => {
    const directory = await scratch();

    const result = await withWriteLock(directory, async () =>
      withWriteLock(directory, async () => 'nested'),
    );

    expect(result).toBe('nested');
    expect(await readdir(directory)).not.toContain(WRITE_LOCK_FILE_NAME);
  });
});
