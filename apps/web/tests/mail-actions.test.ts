import { describe, expect, it, vi } from 'vitest';
import type {
  AcceptMailProposalDeps,
  AcceptMailProposalResult,
  MailProposal,
} from '@job-queue/core';
import { acceptAllMail } from '@/server/mail-use-cases';
import { acceptAllFromForm, bulkAcceptRedirect } from '@/server/mail-actions-core';

/**
 * U5d: the modal's Aceptar applies EVERY pending proposal. The bulk accept
 * reuses the existing per-proposal accept path (acceptMailProposal through
 * acceptMail), so each application change stays append-only and reversible
 * with history source `Correo`. These tests pin the Next-free counterpart
 * (`mail-use-cases` + `mail-actions-core`); the `'use server'` shell and the
 * client component are covered by the e2e.
 */

function proposal(id: string): MailProposal {
  return {
    id,
    jobId: `acme::puesto::${id}`,
    proposedOutcome: 'rejected',
    basedOnOutcome: 'applied',
    messageId: `msg-${id}`,
    snippet: 'Lamentamos informarte que no seguimos adelante.',
    evidence: ['no seguimos'],
    detectedAt: new Date('2026-03-05T08:00:00.000Z'),
    status: 'pending',
  };
}

function depsWith(pending: readonly MailProposal[]): AcceptMailProposalDeps {
  return {
    proposals: { listPending: async () => pending } as never,
    applications: {} as never,
    history: {} as never,
    now: () => new Date('2026-03-10T12:00:00.000Z'),
  };
}

function runReturning(byId: Record<string, AcceptMailProposalResult>) {
  return vi.fn(async ({ proposalId }: { readonly proposalId: string }) => {
    const result = byId[proposalId];
    if (result === undefined) {
      throw new Error(`unexpected proposal ${proposalId}`);
    }
    return result;
  });
}

const ACCEPTED: AcceptMailProposalResult = { status: 'accepted', historyEntryId: 'h1' };
const UNTRACKED: AcceptMailProposalResult = { status: 'accepted_untracked', historyEntryId: null };

const ZERO = {
  accepted: 0,
  acceptedUntracked: 0,
  conflict: 0,
  alreadyDecided: 0,
  applicationNotFound: 0,
  refused: 0,
  notFound: 0,
};

describe('acceptAllMail (bulk accept use case)', () => {
  it('applies every pending proposal through the accept path and tallies each result', async () => {
    const run = runReturning({
      p1: ACCEPTED,
      p2: { status: 'conflict' },
      p3: { status: 'refused', reason: 'invalid_outcome' },
    });
    const deps = depsWith([proposal('p1'), proposal('p2'), proposal('p3')]);
    const result = await acceptAllMail(deps, run);
    expect(result).toEqual({ ...ZERO, accepted: 1, conflict: 1, refused: 1 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledWith({ proposalId: 'p1' }, deps);
    expect(run).toHaveBeenCalledWith({ proposalId: 'p2' }, deps);
    expect(run).toHaveBeenCalledWith({ proposalId: 'p3' }, deps);
  });

  it('reuses every existing accept result, including untracked, already decided, gone and not found', async () => {
    const run = runReturning({
      p1: UNTRACKED,
      p2: { status: 'already_decided' },
      p3: { status: 'application_not_found' },
      p4: { status: 'not_found' },
    });
    const result = await acceptAllMail(depsWith([proposal('p1'), proposal('p2'), proposal('p3'), proposal('p4')]), run);
    expect(result).toEqual({
      ...ZERO,
      acceptedUntracked: 1,
      alreadyDecided: 1,
      applicationNotFound: 1,
      notFound: 1,
    });
  });

  it('a thrown per-proposal accept counts as refused, never fails the whole batch', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await acceptAllMail(depsWith([proposal('p1')]), run);
    expect(result).toEqual({ ...ZERO, refused: 1 });
  });

  it('an empty pending list is all zeros, not a failure', async () => {
    const run = vi.fn();
    const result = await acceptAllMail(depsWith([]), run);
    expect(result).toEqual(ZERO);
    expect(run).not.toHaveBeenCalled();
  });

  it('a failing proposal repository is the typed failed result, never a throw', async () => {
    const deps = {
      ...depsWith([]),
      proposals: {
        listPending: async () => {
          throw new Error('C:\\secret\\mail-proposals.json');
        },
      } as never,
    };
    const result = await acceptAllMail(deps, runReturning({}));
    expect(result).toEqual({ status: 'failed' });
  });
});

describe('bulk accept redirect', () => {
  it('maps the counts to the closed aplicadas slug with only the nonzero buckets', () => {
    expect(
      bulkAcceptRedirect({ ...ZERO, accepted: 2, conflict: 1 }),
    ).toBe('/seguimiento?correo=aplicadas&aplicados=2&conflicto=1#correo');
    expect(
      bulkAcceptRedirect({ ...ZERO, acceptedUntracked: 1, applicationNotFound: 3 }),
    ).toBe('/seguimiento?correo=aplicadas&sin-registro=1&sin-postulacion=3#correo');
  });

  it('with nothing to apply the redirect carries no counts', () => {
    expect(bulkAcceptRedirect(ZERO)).toBe('/seguimiento?correo=aplicadas#correo');
  });

  it('the typed failed result reuses the existing generic refusal slug', () => {
    expect(bulkAcceptRedirect({ status: 'failed' })).toBe('/seguimiento?correo=rechazada#correo');
  });
});

describe('acceptAllFromForm', () => {
  it('returns the bulk redirect for the use-case result', async () => {
    const to = await acceptAllFromForm(depsWith([]), runReturning({}));
    expect(to).toBe('/seguimiento?correo=aplicadas#correo');
  });

  it('an unexpected throw lands on the generic refusal slug and never echoes the message', async () => {
    const deps = {
      ...depsWith([]),
      proposals: {
        listPending: async () => {
          throw new Error('C:\\secret');
        },
      } as never,
    };
    const to = await acceptAllFromForm(deps, runReturning({}));
    expect(to).toBe('/seguimiento?correo=rechazada#correo');
    expect(to).not.toContain('secret');
  });
});
