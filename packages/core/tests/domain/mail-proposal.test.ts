import { describe, expect, it } from 'vitest';
import {
  MAX_PROPOSAL_SNIPPET_LENGTH,
  createMailProposal,
  isMailProposalOutcome,
  sanitizeSnippet,
  type MailProposalDraft,
} from '../../src/domain/mail-proposal.js';

const draft: MailProposalDraft = {
  id: 'p1',
  jobId: 'nubesol::dev::madrid',
  proposedOutcome: 'interview',
  messageId: 'm-1',
  snippet: 'Te invitamos a una entrevista',
  evidence: ['entrevista'],
  detectedAt: new Date('2026-02-03T08:00:00Z'),
};

describe('createMailProposal', () => {
  it('creates a pending proposal', () => {
    const proposal = createMailProposal(draft);
    expect(proposal).toEqual({ ...draft, status: 'pending' });
    expect(proposal.historyEntryId).toBeUndefined();
  });

  it('never carries a body field', () => {
    const keys = Object.keys(createMailProposal({ ...draft, body: 'secret' } as MailProposalDraft));
    expect(keys).not.toContain('body');
    expect(keys.sort()).toEqual(
      ['detectedAt', 'evidence', 'id', 'jobId', 'messageId', 'proposedOutcome', 'snippet', 'status'].sort(),
    );
  });

  it('truncates the snippet to 200 characters', () => {
    const proposal = createMailProposal({ ...draft, snippet: 'a'.repeat(500) });
    expect(proposal.snippet).toHaveLength(MAX_PROPOSAL_SNIPPET_LENGTH);
    expect(MAX_PROPOSAL_SNIPPET_LENGTH).toBe(200);
  });

  it('strips control characters and folds line breaks', () => {
    expect(sanitizeSnippet('hola\u0000 mun\u0007do\u001b[31m')).toBe('hola mundo[31m');
    expect(sanitizeSnippet('uno\r\ndos\t tres')).toBe('uno dos tres');
    expect(sanitizeSnippet('  \u0001  ')).toBe('');
  });

  it.each([
    ['id', { id: ' ' }],
    ['jobId', { jobId: '' }],
    ['messageId', { messageId: ' ' }],
    ['detectedAt', { detectedAt: new Date('nope') }],
    ['proposedOutcome', { proposedOutcome: 'applied' as never }],
  ])('refuses an invalid %s', (_name, patch) => {
    expect(() => createMailProposal({ ...draft, ...patch })).toThrow();
  });

  it('trims ids and copies evidence', () => {
    const evidence = ['a'];
    const proposal = createMailProposal({ ...draft, id: ' p1 ', messageId: ' m-1 ', evidence });
    expect(proposal.id).toBe('p1');
    expect(proposal.messageId).toBe('m-1');
    expect(proposal.evidence).not.toBe(evidence);
  });
});

describe('isMailProposalOutcome', () => {
  it('accepts only outcomes a mail can announce', () => {
    for (const ok of ['rejected', 'screening', 'interview', 'offer']) {
      expect(isMailProposalOutcome(ok)).toBe(true);
    }
    for (const bad of ['applied', 'no_reply', 5, undefined]) {
      expect(isMailProposalOutcome(bad)).toBe(false);
    }
  });
});

describe('createMailProposal basedOnOutcome', () => {
  it('records the outcome the proposal was built against', () => {
    expect(createMailProposal({ ...draft, basedOnOutcome: 'applied' }).basedOnOutcome).toBe('applied');
  });

  it('omits the key entirely when none is given (legacy shape)', () => {
    expect('basedOnOutcome' in createMailProposal(draft)).toBe(false);
  });
});
