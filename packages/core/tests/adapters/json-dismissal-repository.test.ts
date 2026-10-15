import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonDismissalRepository } from '../../src/adapters/persistence/json-dismissal-repository.js';
import type { DismissalRepository } from '../../src/ports/dismissal-repository.js';

/**
 * The dismissal store, held to exactly the contract the application log already
 * has: atomic writes, in-process serialization, idempotent create, and a
 * refusal to overwrite a file it cannot parse.
 *
 * The last one matters more here than it looks. A dismissal is the record of a
 * decision the human made by hand; silently resetting the file would quietly
 * resurrect every offer they already said no to, which is the exact "invisible
 * failure" this codebase keeps refusing.
 */

const NOW = new Date('2026-03-10T09:00:00.000Z');
const LATER = new Date('2026-03-11T09:00:00.000Z');

let directory: string;
let filePath: string;
let repository: DismissalRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dismissals-'));
  filePath = join(directory, 'dismissals.json');
  repository = createJsonDismissalRepository({ filePath });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function draft(jobId: string, dismissedAt = NOW) {
  return { jobId, dismissedAt, title: `Title of ${jobId}`, company: 'ACME' };
}

describe('createJsonDismissalRepository', () => {
  it('reports an empty list when nothing has ever been dismissed', async () => {
    expect(await repository.list()).toEqual([]);
    expect(await repository.findByJobId('a::b::c')).toBeNull();
  });

  it('persists a dismissal to disk', async () => {
    const result = await repository.dismiss(draft('a::b::c'));

    expect(result.created).toBe(true);
    expect(result.dismissal.jobId).toBe('a::b::c');

    const stored: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    expect(stored).toMatchObject({
      version: 1,
      dismissals: [{ jobId: 'a::b::c', dismissedAt: NOW.toISOString(), company: 'ACME' }],
    });
  });

  it('is idempotent: dismissing twice records ONE dismissal', async () => {
    const first = await repository.dismiss(draft('a::b::c'));
    const second = await repository.dismiss(draft('a::b::c', LATER));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // The ORIGINAL timestamp survives: when he decided is history.
    expect(second.dismissal.dismissedAt).toEqual(NOW);
    expect(await repository.list()).toHaveLength(1);
  });

  it('is idempotent even when three dismissals race', async () => {
    await Promise.all([
      repository.dismiss(draft('a::b::c')),
      repository.dismiss(draft('a::b::c')),
      repository.dismiss(draft('a::b::c')),
    ]);

    expect(await repository.list()).toHaveLength(1);
  });

  it('restores a dismissal and reports that it removed something', async () => {
    await repository.dismiss(draft('a::b::c'));

    expect(await repository.restore('a::b::c')).toBe(true);
    expect(await repository.list()).toEqual([]);
    expect(await repository.findByJobId('a::b::c')).toBeNull();
  });

  it('reports restoring something that was never dismissed as a no-op', async () => {
    expect(await repository.restore('never::dismissed::anywhere')).toBe(false);
  });

  it('restores only the requested job', async () => {
    await repository.dismiss(draft('a::b::c'));
    await repository.dismiss(draft('d::e::f'));

    await repository.restore('a::b::c');

    const remaining = await repository.list();
    expect(remaining.map((entry) => entry.jobId)).toEqual(['d::e::f']);
  });

  it('re-dismissing after a restore is allowed and creates a fresh record', async () => {
    await repository.dismiss(draft('a::b::c'));
    await repository.restore('a::b::c');
    const again = await repository.dismiss(draft('a::b::c', LATER));

    expect(again.created).toBe(true);
    expect(again.dismissal.dismissedAt).toEqual(LATER);
  });

  it('survives a reopen: a second repository sees the same file', async () => {
    await repository.dismiss(draft('a::b::c'));

    const reopened = createJsonDismissalRepository({ filePath });
    expect((await reopened.list()).map((entry) => entry.jobId)).toEqual(['a::b::c']);
  });

  it('lists newest first', async () => {
    await repository.dismiss(draft('older::x::y', NOW));
    await repository.dismiss(draft('newer::x::y', LATER));

    expect((await repository.list()).map((entry) => entry.jobId)).toEqual([
      'newer::x::y',
      'older::x::y',
    ]);
  });

  it('refuses to overwrite a file it cannot parse', async () => {
    await writeFile(filePath, 'not json at all', 'utf8');

    await expect(repository.list()).rejects.toThrow(/not valid JSON/i);
    // And the human's file is still exactly where it was.
    expect(await readFile(filePath, 'utf8')).toBe('not json at all');
  });

  it('refuses to overwrite a file whose schema it does not recognise', async () => {
    await writeFile(filePath, JSON.stringify({ version: 99, dismissals: [] }), 'utf8');

    await expect(repository.list()).rejects.toThrow(/schema/i);
  });

  it('leaves no temp files behind', async () => {
    await repository.dismiss(draft('a::b::c'));
    await repository.restore('a::b::c');

    const { readdir } = await import('node:fs/promises');
    const left = await readdir(directory);
    expect(left).toEqual(['dismissals.json']);
  });
});
