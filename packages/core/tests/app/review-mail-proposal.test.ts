import { describe, expect, it } from 'vitest';
import { editApplication } from '../../src/app/edit-application.js';
import { revertApplicationChange } from '../../src/app/revert-application-change.js';
import { acceptMailProposal, dismissMailProposal } from '../../src/app/review-mail-proposal.js';
import {
  ApplicationPatchError,
  createApplication,
  type Application,
} from '../../src/domain/application.js';
import {
  createMailProposal,
  type MailProposal,
  type MailProposalStatus,
} from '../../src/domain/mail-proposal.js';
import type { ApplicationRepository } from '../../src/ports/application-repository.js';
import type {
  AddMailProposalResult,
  MailProposalRepository,
} from '../../src/ports/mail-proposal-repository.js';
import { createInMemoryApplicationHistoryRepository } from '../helpers/in-memory-application-history-repository.js';
import { createInMemoryApplicationRepository } from '../helpers/in-memory-application-repository.js';
import { createRecordingLogger } from '../helpers/silent-logger.js';

const JOB = 'nubesol::desarrollador::madrid';
const APP = createApplication({
  jobId: JOB,
  appliedAt: new Date('2026-02-01T12:34:56.000Z'),
  outcome: 'applied',
  notes: 'Ñandú',
});

function proposal(overrides: Partial<MailProposal> = {}): MailProposal {
  return {
    ...createMailProposal({
      id: 'p1',
      jobId: JOB,
      proposedOutcome: 'rejected',
      basedOnOutcome: 'applied',
      messageId: 'm1',
      snippet: 'Lamentamos comunicarle',
      evidence: ['lamentamos'],
      detectedAt: new Date('2026-02-10T10:00:00Z'),
    }),
    ...overrides,
  };
}

/** A proposal stored before `basedOnOutcome` existed: the key is absent. */
function legacyProposal(): MailProposal {
  const { basedOnOutcome: _omitted, ...rest } = proposal();
  return rest;
}

interface ProposalOptions {
  readonly acceptReturnsNull?: boolean;
  readonly acceptThrows?: boolean;
}

function proposalRepo(seed: MailProposal[], options: ProposalOptions = {}) {
  const store = new Map(seed.map((p) => [p.id, p]));
  const repository: MailProposalRepository = {
    async list() {
      return [...store.values()];
    },
    async listPending() {
      return [...store.values()].filter((p) => p.status === 'pending');
    },
    async findByMessageId(messageId) {
      return [...store.values()].find((p) => p.messageId === messageId) ?? null;
    },
    async add(p): Promise<AddMailProposalResult> {
      store.set(p.id, p);
      return { proposal: p, created: true };
    },
    async markAccepted(id, historyEntryId) {
      if (options.acceptThrows === true) throw new Error('disk full C:\\secret\\path');
      const current = store.get(id);
      if (options.acceptReturnsNull === true || current === undefined || current.status !== 'pending') {
        return null;
      }
      const next = { ...current, status: 'accepted' as MailProposalStatus, historyEntryId };
      store.set(id, next);
      return next;
    },
    async markDismissed(id) {
      const current = store.get(id);
      if (current === undefined || current.status !== 'pending') return null;
      const next = { ...current, status: 'dismissed' as MailProposalStatus };
      store.set(id, next);
      return next;
    },
  };
  return { repository, store };
}

function setup(seedProposals: MailProposal[] = [proposal()], options: ProposalOptions = {}) {
  const applications = createInMemoryApplicationRepository([APP]);
  const history = createInMemoryApplicationHistoryRepository();
  const { repository: proposals, store } = proposalRepo(seedProposals, options);
  let tick = 0;
  let counter = 0;
  const logger = createRecordingLogger();
  const deps = {
    proposals,
    applications,
    history,
    logger,
    now: () => new Date(Date.UTC(2026, 3, 10, 9, 0, tick++)),
    newId: () => `id-${++counter}`,
  };
  const editDeps = { repository: applications, history, now: deps.now, newId: deps.newId };
  const current = async (): Promise<Application> => {
    const found = await applications.findByJobId(JOB);
    if (found === null) throw new Error('missing');
    return found;
  };
  return { applications, history, store, deps, editDeps, logger, current };
}

describe('acceptMailProposal', () => {
  it('applies the proposed outcome as exactly one email history entry', async () => {
    const { deps, history, current, store } = setup();
    const result = await acceptMailProposal({ proposalId: 'p1' }, deps);
    expect(result.status).toBe('accepted');
    expect((await current()).outcome).toBe('rejected');
    const entries = history.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: 'email', jobId: JOB });
    expect(entries[0]?.changes.find((c) => c.field === 'outcome')).toMatchObject({
      before: 'applied',
      after: 'rejected',
    });
    expect(result).toEqual({ status: 'accepted', historyEntryId: entries[0]?.id });
    expect(store.get('p1')).toMatchObject({ status: 'accepted', historyEntryId: entries[0]?.id });
  });

  it('is not_found for an unknown id and writes nothing', async () => {
    const { deps, history } = setup();
    expect(await acceptMailProposal({ proposalId: 'nope' }, deps)).toEqual({ status: 'not_found' });
    expect(history.all()).toHaveLength(0);
  });

  it.each(['accepted', 'dismissed'] as const)('is already_decided when %s', async (status) => {
    const { deps, history, current } = setup([proposal({ status })]);
    expect(await acceptMailProposal({ proposalId: 'p1' }, deps)).toEqual({ status: 'already_decided' });
    expect(history.all()).toHaveLength(0);
    expect((await current()).outcome).toBe('applied');
  });

  it('is application_not_found when the application is gone', async () => {
    const { deps, history } = setup([proposal({ jobId: 'ghost::job::x' })]);
    expect(await acceptMailProposal({ proposalId: 'p1' }, deps)).toEqual({
      status: 'application_not_found',
    });
    expect(history.all()).toHaveLength(0);
  });

  it('is conflict when the user changed the outcome by hand meanwhile', async () => {
    const { deps, editDeps, history, current, store } = setup();
    await editApplication({ jobId: JOB, patch: { outcome: 'screening' } }, editDeps);
    const before = history.all().length;
    const snapshot = JSON.stringify(await current());
    expect(await acceptMailProposal({ proposalId: 'p1' }, deps)).toEqual({ status: 'conflict' });
    expect(history.all()).toHaveLength(before);
    expect(JSON.stringify(await current())).toBe(snapshot);
    expect(store.get('p1')?.status).toBe('pending');
  });

  it('is conflict when the outcome already equals the proposed one (no basedOnOutcome)', async () => {
    const { deps, editDeps, history, store } = setup([legacyProposal()]);
    await editApplication({ jobId: JOB, patch: { outcome: 'rejected' } }, editDeps);
    const before = history.all().length;
    expect(await acceptMailProposal({ proposalId: 'p1' }, deps)).toEqual({ status: 'conflict' });
    expect(history.all()).toHaveLength(before);
    expect(store.get('p1')?.status).toBe('pending');
  });

  it('is conflict when the outcome already equals the proposed one (with basedOnOutcome)', async () => {
    const { deps, editDeps, history } = setup([proposal({ basedOnOutcome: 'rejected' })]);
    await editApplication({ jobId: JOB, patch: { outcome: 'rejected' } }, editDeps);
    const before = history.all().length;
    expect(await acceptMailProposal({ proposalId: 'p1' }, deps)).toEqual({ status: 'conflict' });
    expect(history.all()).toHaveLength(before);
  });

  it('accepts a stored proposal without basedOnOutcome by comparing to the proposed outcome only', async () => {
    const { deps, current } = setup([legacyProposal()]);
    const result = await acceptMailProposal({ proposalId: 'p1' }, deps);
    expect(result.status).toBe('accepted');
    expect((await current()).outcome).toBe('rejected');
  });

  it('keeps the history entry and reports accepted_untracked when markAccepted returns null', async () => {
    const { deps, history, current, logger } = setup([proposal()], { acceptReturnsNull: true });
    const result = await acceptMailProposal({ proposalId: 'p1' }, deps);
    expect(result).toEqual({ status: 'accepted_untracked', historyEntryId: history.all()[0]?.id });
    expect(history.all()).toHaveLength(1);
    expect((await current()).outcome).toBe('rejected');
    expect(logger.messages.length).toBeGreaterThan(0);
  });

  it('keeps the history entry and reports accepted_untracked when markAccepted throws', async () => {
    const { deps, history, logger } = setup([proposal()], { acceptThrows: true });
    const result = await acceptMailProposal({ proposalId: 'p1' }, deps);
    expect(result.status).toBe('accepted_untracked');
    expect(history.all()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(logger.messages.some((m) => m.message.includes('secret'))).toBe(true);
  });

  it('works without a logger', async () => {
    const { deps } = setup([proposal()], { acceptThrows: true });
    const { logger: _logger, ...noLogger } = deps;
    expect((await acceptMailProposal({ proposalId: 'p1' }, noLogger)).status).toBe(
      'accepted_untracked',
    );
  });

  it('is refused when the edit use case refuses, leaving the proposal pending', async () => {
    const refusing: ApplicationRepository = {
      ...createInMemoryApplicationRepository([APP]),
      async update() {
        throw new ApplicationPatchError('invalid_date');
      },
    };
    const { deps, store, history } = setup();
    const result = await acceptMailProposal({ proposalId: 'p1' }, { ...deps, applications: refusing });
    expect(result.status).toBe('refused');
    expect(store.get('p1')?.status).toBe('pending');
    expect(history.all()).toHaveLength(0);
  });

  it('round trip: revert restores the application byte-identically and the proposal stays accepted', async () => {
    const { deps, editDeps, history, current, store } = setup();
    const original = JSON.stringify(APP);
    const accepted = await acceptMailProposal({ proposalId: 'p1' }, deps);
    if (accepted.status !== 'accepted') throw new Error('expected accepted');
    const reverted = await revertApplicationChange({ entryId: accepted.historyEntryId }, editDeps);
    expect(reverted).toMatchObject({ status: 'reverted' });
    expect(JSON.stringify(await current())).toBe(original);
    const entries = history.all();
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ source: 'revert', revertsId: accepted.historyEntryId });
    expect(store.get('p1')?.status).toBe('accepted');
  });
});

describe('dismissMailProposal', () => {
  it('marks the proposal dismissed and never touches applications or history', async () => {
    const { deps, store } = setup();
    // dismiss only receives the proposal store: nothing else can be written.
    expect(await dismissMailProposal({ proposalId: 'p1' }, { proposals: deps.proposals })).toEqual({
      status: 'dismissed',
    });
    expect(store.get('p1')?.status).toBe('dismissed');
  });

  it('does not write applications or history even if they throw on write', async () => {
    const { deps } = setup();
    const throwing = {
      proposals: deps.proposals,
      applications: {
        update: () => Promise.reject(new Error('must not write')),
        updateOutcome: () => Promise.reject(new Error('must not write')),
        record: () => Promise.reject(new Error('must not write')),
      },
      history: { append: () => Promise.reject(new Error('must not write')) },
    };
    expect(await dismissMailProposal({ proposalId: 'p1' }, throwing)).toEqual({ status: 'dismissed' });
  });

  it('is not_found for an unknown id', async () => {
    const { deps } = setup();
    expect(await dismissMailProposal({ proposalId: 'nope' }, { proposals: deps.proposals })).toEqual({
      status: 'not_found',
    });
  });

  it.each(['accepted', 'dismissed'] as const)('is already_decided when %s', async (status) => {
    const { deps } = setup([proposal({ status })]);
    expect(await dismissMailProposal({ proposalId: 'p1' }, { proposals: deps.proposals })).toEqual({
      status: 'already_decided',
    });
  });
});
