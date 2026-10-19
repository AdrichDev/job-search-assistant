import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OUTCOMES,
  createApplication,
  isAdvance,
  isApplicationOutcome,
  isResponse,
  withOutcome,
} from '../../src/domain/application.js';
import { REFERENCE_NOW, daysAgo } from '../helpers/make-job.js';

const DRAFT = {
  jobId: 'acme::junior dev::madrid',
  appliedAt: REFERENCE_NOW,
  cvVariant: 'frontend' as const,
  scoreAtApply: 87.6,
};

describe('createApplication', () => {
  it('starts a new application in the "applied" outcome', () => {
    const application = createApplication(DRAFT);
    expect(application.outcome).toBe('applied');
  });

  it('stamps outcomeUpdatedAt with the application date', () => {
    const application = createApplication(DRAFT);
    expect(application.outcomeUpdatedAt.getTime()).toBe(REFERENCE_NOW.getTime());
  });

  it('freezes the score at the moment of applying, so later retuning cannot rewrite history', () => {
    const application = createApplication(DRAFT);
    expect(application.scoreAtApply).toBe(87.6);
    expect(application.cvVariant).toBe('frontend');
  });

  it('omits notes entirely when none are given', () => {
    const application = createApplication(DRAFT);
    expect('notes' in application).toBe(false);
  });

  it('keeps notes when provided', () => {
    const application = createApplication({ ...DRAFT, notes: 'referred by Marta' });
    expect(application.notes).toBe('referred by Marta');
  });

  it('accepts an explicit starting outcome for imported history', () => {
    const application = createApplication({ ...DRAFT, outcome: 'interview' });
    expect(application.outcome).toBe('interview');
  });

  it('rejects an empty job id', () => {
    expect(() => createApplication({ ...DRAFT, jobId: '  ' })).toThrow(/job id/i);
  });

  it('rejects a non-finite score', () => {
    expect(() => createApplication({ ...DRAFT, scoreAtApply: Number.NaN })).toThrow(/score/i);
  });
});

describe('withOutcome', () => {
  it('moves the application to the new outcome', () => {
    const updated = withOutcome(createApplication(DRAFT), 'interview', daysAgo(-2));
    expect(updated.outcome).toBe('interview');
  });

  it('advances outcomeUpdatedAt but never appliedAt', () => {
    const later = daysAgo(-3);
    const updated = withOutcome(createApplication(DRAFT), 'rejected', later);
    expect(updated.outcomeUpdatedAt.getTime()).toBe(later.getTime());
    expect(updated.appliedAt.getTime()).toBe(REFERENCE_NOW.getTime());
  });

  it('replaces notes when new ones are supplied', () => {
    const base = createApplication({ ...DRAFT, notes: 'first' });
    const updated = withOutcome(base, 'screening', REFERENCE_NOW, 'call on Friday');
    expect(updated.notes).toBe('call on Friday');
  });

  it('preserves existing notes when none are supplied', () => {
    const base = createApplication({ ...DRAFT, notes: 'keep me' });
    const updated = withOutcome(base, 'screening', REFERENCE_NOW);
    expect(updated.notes).toBe('keep me');
  });
});

describe('outcome classification', () => {
  it('exposes every outcome the UI must be able to set', () => {
    expect([...APPLICATION_OUTCOMES]).toEqual([
      'applied',
      'no_reply',
      'rejected',
      'screening',
      'interview',
      'offer',
    ]);
  });

  it('counts a rejection as a response: somebody actually replied', () => {
    expect(isResponse('rejected')).toBe(true);
  });

  it('does not count silence or a pending application as a response', () => {
    expect(isResponse('applied')).toBe(false);
    expect(isResponse('no_reply')).toBe(false);
  });

  it('counts only forward movement as an advance', () => {
    expect(isAdvance('screening')).toBe(true);
    expect(isAdvance('interview')).toBe(true);
    expect(isAdvance('offer')).toBe(true);
    expect(isAdvance('rejected')).toBe(false);
  });

  it('guards unknown values crossing the boundary', () => {
    expect(isApplicationOutcome('offer')).toBe(true);
    expect(isApplicationOutcome('hired')).toBe(false);
    expect(isApplicationOutcome(7)).toBe(false);
  });
});

describe('imported history (no CV, no score, with a listing)', () => {
  it('mints an application without a CV variant or score and keeps its listing', () => {
    const imported = createApplication({
      jobId: 'import-1',
      appliedAt: REFERENCE_NOW,
      sourceIds: ['infojobs'],
      outcome: 'rejected',
      listing: { company: '  Acme ', title: 'Junior Dev', url: 'https://example.com/o/1', portal: 'InfoJobs', city: 'Madrid' },
    });

    expect(imported.cvVariant).toBeUndefined();
    expect(imported.scoreAtApply).toBeUndefined();
    expect(imported.outcome).toBe('rejected');
    expect(imported.listing).toEqual({
      company: 'Acme',
      title: 'Junior Dev',
      url: 'https://example.com/o/1',
      portal: 'InfoJobs',
      city: 'Madrid',
    });
  });

  it('still refuses a non-finite score when one is supplied', () => {
    expect(() =>
      createApplication({ jobId: 'x', appliedAt: REFERENCE_NOW, cvVariant: 'general', scoreAtApply: Number.NaN }),
    ).toThrow(/finite score/);
  });

  it('refuses a listing without company or title', () => {
    expect(() =>
      createApplication({ jobId: 'x', appliedAt: REFERENCE_NOW, listing: { company: ' ', title: 'Dev' } }),
    ).toThrow(/listing/i);
  });
});
