import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonMailProposalRepository } from '../../src/adapters/persistence/json-mail-proposal-repository.js';
import { createMailProposal } from '../../src/domain/mail-proposal.js';

let directory: string;
let filePath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mail-proposals-'));
  filePath = join(directory, 'mail-proposals.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function proposal(messageId: string, at = '2026-02-03T08:00:00.000Z', id = `p-${messageId}`) {
  return createMailProposal({
    id,
    jobId: 'nubesol::dev::madrid',
    proposedOutcome: 'interview',
    messageId,
    snippet: 'Te invitamos a una entrevista',
    evidence: ['entrevista'],
    detectedAt: new Date(at),
  });
}

describe('createJsonMailProposalRepository', () => {
  it('reads a missing file as empty without creating it', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    expect(await repository.list()).toEqual([]);
    expect(await repository.listPending()).toEqual([]);
    expect(await repository.findByMessageId('x')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('adds and round-trips a proposal, dates included', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    const result = await repository.add(proposal('m1'));
    expect(result.created).toBe(true);
    const again = createJsonMailProposalRepository({ filePath });
    expect(await again.findByMessageId('m1')).toEqual(proposal('m1'));
    expect(await readdir(directory)).toEqual(['mail-proposals.json']);
  });

  it('persists the portal the alert revealed and reads it back', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add(
      createMailProposal({
        id: 'p-portal',
        jobId: 'nubesol::dev::madrid',
        proposedOutcome: 'interview',
        messageId: 'm-portal',
        snippet: 'Te invitamos a una entrevista',
        evidence: ['entrevista'],
        detectedAt: new Date('2026-02-03T08:00:00.000Z'),
        portal: 'infojobs',
      }),
    );
    const again = createJsonMailProposalRepository({ filePath });
    expect((await again.findByMessageId('m-portal'))?.portal).toBe('infojobs');
  });

  it('reads back a proposal stored before the portal field existed', async () => {
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          version: 1,
          proposals: [
            {
              id: 'p-old',
              jobId: 'nubesol::dev::madrid',
              proposedOutcome: 'interview',
              messageId: 'm-old',
              snippet: 'Te invitamos a una entrevista',
              evidence: ['entrevista'],
              detectedAt: '2026-02-03T08:00:00.000Z',
              status: 'pending',
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    const repository = createJsonMailProposalRepository({ filePath });
    const read = await repository.findByMessageId('m-old');
    expect(read).not.toBeNull();
    expect('portal' in (read ?? {})).toBe(false);
    // And the file stays writable without inventing a portal.
    await repository.markDismissed('p-old');
    expect((await repository.list())[0]?.status).toBe('dismissed');
  });

  it('is idempotent by messageId and keeps the original untouched', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add(proposal('m1'));
    const second = await repository.add(proposal('m1', '2027-01-01T00:00:00.000Z', 'other-id'));
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe('p-m1');
    expect(await repository.list()).toHaveLength(1);
  });

  it('lists newest first and pending only for listPending', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add(proposal('old', '2026-01-01T00:00:00.000Z'));
    await repository.add(proposal('new', '2026-03-01T00:00:00.000Z'));
    await repository.add(proposal('mid', '2026-02-01T00:00:00.000Z'));
    await repository.markDismissed('p-mid');
    expect((await repository.list()).map((p) => p.messageId)).toEqual(['new', 'mid', 'old']);
    expect((await repository.listPending()).map((p) => p.messageId)).toEqual(['new', 'old']);
  });

  it('marks accepted with the history entry id, once', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add(proposal('m1'));
    const accepted = await repository.markAccepted('p-m1', 'h-9');
    expect(accepted).toMatchObject({ status: 'accepted', historyEntryId: 'h-9' });
    expect(await repository.markAccepted('p-m1', 'h-10')).toBeNull();
    expect(await repository.markDismissed('p-m1')).toBeNull();
    expect((await repository.findByMessageId('m1'))?.historyEntryId).toBe('h-9');
    expect(await repository.listPending()).toEqual([]);
  });

  it('marks dismissed, once, and keeps it so the mail is never proposed again', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add(proposal('m1'));
    expect(await repository.markDismissed('p-m1')).toMatchObject({ status: 'dismissed' });
    expect(await repository.markAccepted('p-m1', 'h')).toBeNull();
    expect((await repository.add(proposal('m1'))).created).toBe(false);
    expect((await repository.findByMessageId('m1'))?.status).toBe('dismissed');
  });

  it('returns null for an unknown id', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    expect(await repository.markDismissed('nope')).toBeNull();
    expect(await repository.markAccepted('nope', 'h')).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });

  it('survives concurrent adds', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await Promise.all(['a', 'b', 'c', 'a'].map((id) => repository.add(proposal(id))));
    expect(await repository.list()).toHaveLength(3);
  });

  it('stores no body field on disk', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add(proposal('m1'));
    expect(await readFile(filePath, 'utf8')).not.toMatch(/"body"/);
  });

  const corrupt: ReadonlyArray<readonly [string, string]> = [
    ['invalid JSON', '{not json'],
    ['a wrong shape', JSON.stringify({ version: 1, proposals: 5 })],
    ['a wrong version', JSON.stringify({ version: 2, proposals: [] })],
    [
      'an invalid date',
      JSON.stringify({
        version: 1,
        proposals: [{ ...proposal('m1'), detectedAt: 'yesterday' }],
      }),
    ],
  ];

  it.each(corrupt)('refuses %s and leaves the file byte-identical', async (_name, content) => {
    await writeFile(filePath, content, 'utf8');
    const repository = createJsonMailProposalRepository({ filePath });

    await expect(repository.list()).rejects.toThrow(/Refusing to overwrite/);
    await expect(repository.add(proposal('m9'))).rejects.toThrow(/Refusing to overwrite/);
    await expect(repository.markDismissed('p-m1')).rejects.toThrow(/Refusing to overwrite/);
    await expect(repository.markAccepted('p-m1', 'h')).rejects.toThrow(/Refusing to overwrite/);

    expect(await readFile(filePath, 'utf8')).toBe(content);
    expect(await readdir(directory)).toEqual(['mail-proposals.json']);
  });
});

describe('basedOnOutcome persistence', () => {
  it('round-trips basedOnOutcome', async () => {
    const repository = createJsonMailProposalRepository({ filePath });
    await repository.add({ ...proposal('m1'), basedOnOutcome: 'applied' });
    expect((await repository.findByMessageId('m1'))?.basedOnOutcome).toBe('applied');
  });

  it('reads a stored proposal that lacks basedOnOutcome', async () => {
    const stored = { ...proposal('m1'), detectedAt: '2026-02-03T08:00:00.000Z' };
    await writeFile(filePath, JSON.stringify({ version: 1, proposals: [stored] }), 'utf8');
    const repository = createJsonMailProposalRepository({ filePath });
    const [read] = await repository.list();
    expect(read?.id).toBe('p-m1');
    expect(read !== undefined && 'basedOnOutcome' in read).toBe(false);
  });

  it('refuses an unknown basedOnOutcome value', async () => {
    const stored = { ...proposal('m1'), detectedAt: '2026-02-03T08:00:00.000Z', basedOnOutcome: 'bogus' };
    await writeFile(filePath, JSON.stringify({ version: 1, proposals: [stored] }), 'utf8');
    await expect(createJsonMailProposalRepository({ filePath }).list()).rejects.toThrow(/Refusing/);
  });
});
