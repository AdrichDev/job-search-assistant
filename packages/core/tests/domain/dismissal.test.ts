import { describe, expect, it } from 'vitest';
import {
  createDismissal,
  indexDismissalsByJobId,
  isDismissalReason,
  type Dismissal,
} from '../../src/domain/dismissal.js';

/**
 * The dismissal entity.
 *
 * Deliberately shaped like `Application`: same `jobId` key, same "minted only
 * through a factory" rule, same trimming. The two stores have to agree about
 * what a vacancy IS, because a dismissal that keys differently from an
 * application is a dismissal that cannot be reconciled with one.
 */

const NOW = new Date('2026-03-10T09:00:00.000Z');

describe('createDismissal', () => {
  it('mints a dismissal from a draft', () => {
    const dismissal = createDismissal({
      jobId: 'acme::junior frontend::madrid',
      dismissedAt: NOW,
      title: 'Junior Frontend Developer',
      company: 'ACME',
    });

    expect(dismissal).toEqual<Dismissal>({
      jobId: 'acme::junior frontend::madrid',
      dismissedAt: NOW,
      title: 'Junior Frontend Developer',
      company: 'ACME',
    });
  });

  it('keeps an optional closed-list reason', () => {
    const dismissal = createDismissal({
      jobId: 'a::b::c', dismissedAt: NOW, title: 't', company: 'c', reason: 'stack_mismatch',
    });

    expect(dismissal.reason).toBe('stack_mismatch');
    expect(isDismissalReason('stack_mismatch')).toBe(true);
    expect(isDismissalReason('made_up')).toBe(false);
  });

  it('trims the job id, exactly as the application factory does', () => {
    const dismissal = createDismissal({
      jobId: '  acme::junior frontend::madrid  ',
      dismissedAt: NOW,
      title: 'Junior Frontend Developer',
      company: 'ACME',
    });

    expect(dismissal.jobId).toBe('acme::junior frontend::madrid');
  });

  it('refuses a blank job id rather than storing an unmatchable row', () => {
    expect(() =>
      createDismissal({ jobId: '   ', dismissedAt: NOW, title: 'x', company: 'y' }),
    ).toThrow(/job id/i);
  });

  /**
   * The snapshot is what makes the review list survive the posting leaving the
   * queue. Without it a restored-but-vanished dismissal is an opaque
   * `company::title::city` string the human cannot recognise.
   */
  it('keeps a readable snapshot of what was dismissed', () => {
    const dismissal = createDismissal({
      jobId: 'kubo labs::desarrollador junior net::alcobendas',
      dismissedAt: NOW,
      title: '  Desarrollador Junior .NET  ',
      company: '  Kubo Labs  ',
    });

    expect(dismissal.title).toBe('Desarrollador Junior .NET');
    expect(dismissal.company).toBe('Kubo Labs');
  });

  it('falls back to a readable placeholder when the snapshot is empty', () => {
    const dismissal = createDismissal({
      jobId: 'a::b::c',
      dismissedAt: NOW,
      title: '',
      company: '',
    });

    expect(dismissal.title.length).toBeGreaterThan(0);
    expect(dismissal.company.length).toBeGreaterThan(0);
  });
});

describe('indexDismissalsByJobId', () => {
  it('keys by job id so a queue can be partitioned in one pass', () => {
    const one = createDismissal({ jobId: 'a::b::c', dismissedAt: NOW, title: 't', company: 'c' });
    const two = createDismissal({ jobId: 'd::e::f', dismissedAt: NOW, title: 't', company: 'c' });

    const index = indexDismissalsByJobId([one, two]);

    expect(index.get('a::b::c')).toBe(one);
    expect(index.get('d::e::f')).toBe(two);
    expect(index.get('nope')).toBeUndefined();
  });
});
