import { describe, expect, it } from 'vitest';
import {
  MAIL_RETRY_COOLDOWN_MS,
  TOKEN_LIFETIME_DAYS,
  isMailCheckAllowed,
  isMailRunDue,
  latestScheduledRun,
  tokenExpiresAt,
  tokenStatus,
} from '../../src/domain/mail-schedule.js';

/**
 * Every instant below is an explicit UTC ISO string, so nothing depends on the
 * machine's own time zone. 08:00 in Madrid is 06:00 UTC in summer (CEST, +2) and
 * 07:00 UTC in winter (CET, +1).
 */
const iso = (value: Date): string => value.toISOString();

describe('latestScheduledRun', () => {
  it('uses today 08:00 when now is after it (winter, 07:00 UTC)', () => {
    expect(iso(latestScheduledRun(new Date('2026-01-15T12:00:00.000Z')))).toBe(
      '2026-01-15T07:00:00.000Z',
    );
  });

  it('uses the previous day when now is before 08:00 Madrid', () => {
    expect(iso(latestScheduledRun(new Date('2026-01-15T06:59:59.000Z')))).toBe(
      '2026-01-14T07:00:00.000Z',
    );
  });

  it('counts exactly 08:00 as the run itself', () => {
    expect(iso(latestScheduledRun(new Date('2026-01-15T07:00:00.000Z')))).toBe(
      '2026-01-15T07:00:00.000Z',
    );
  });

  it('is 06:00 UTC in summer', () => {
    expect(iso(latestScheduledRun(new Date('2026-07-15T12:00:00.000Z')))).toBe(
      '2026-07-15T06:00:00.000Z',
    );
    expect(iso(latestScheduledRun(new Date('2026-07-15T05:59:59.000Z')))).toBe(
      '2026-07-14T06:00:00.000Z',
    );
  });

  it('uses the previous day shortly after Madrid midnight', () => {
    // 22:30 UTC on Jan 14 is 23:30 in Madrid; 23:30 UTC is 00:30 on Jan 15.
    expect(iso(latestScheduledRun(new Date('2026-01-14T23:30:00.000Z')))).toBe(
      '2026-01-14T07:00:00.000Z',
    );
  });

  it('follows the Madrid calendar day, not the UTC one', () => {
    // 22:30 UTC in summer is 00:30 next day in Madrid: still before 08:00 of that day.
    expect(iso(latestScheduledRun(new Date('2026-07-15T22:30:00.000Z')))).toBe(
      '2026-07-15T06:00:00.000Z',
    );
  });

  it('handles the last Sunday of March 2026 (clocks forward at 02:00 -> 03:00)', () => {
    // 2026-03-29. Before the change it is +1; after it +2.
    expect(iso(latestScheduledRun(new Date('2026-03-28T12:00:00.000Z')))).toBe(
      '2026-03-28T07:00:00.000Z',
    );
    expect(iso(latestScheduledRun(new Date('2026-03-29T12:00:00.000Z')))).toBe(
      '2026-03-29T06:00:00.000Z',
    );
    // Right after midnight of the change day, the latest run is still Saturday's.
    expect(iso(latestScheduledRun(new Date('2026-03-29T00:30:00.000Z')))).toBe(
      '2026-03-28T07:00:00.000Z',
    );
    // 06:00 UTC on the change day is exactly 08:00 CEST.
    expect(iso(latestScheduledRun(new Date('2026-03-29T06:00:00.000Z')))).toBe(
      '2026-03-29T06:00:00.000Z',
    );
    // The day after the change.
    expect(iso(latestScheduledRun(new Date('2026-03-30T12:00:00.000Z')))).toBe(
      '2026-03-30T06:00:00.000Z',
    );
  });

  it('handles the last Sunday of October 2026 (clocks back at 03:00 -> 02:00)', () => {
    // 2026-10-25. Before the change it is +2; after it +1.
    expect(iso(latestScheduledRun(new Date('2026-10-24T12:00:00.000Z')))).toBe(
      '2026-10-24T06:00:00.000Z',
    );
    expect(iso(latestScheduledRun(new Date('2026-10-25T12:00:00.000Z')))).toBe(
      '2026-10-25T07:00:00.000Z',
    );
    // 06:30 UTC on the change day is 07:30 CET: still before 08:00, so Saturday's run.
    expect(iso(latestScheduledRun(new Date('2026-10-25T06:30:00.000Z')))).toBe(
      '2026-10-24T06:00:00.000Z',
    );
    expect(iso(latestScheduledRun(new Date('2026-10-25T07:00:00.000Z')))).toBe(
      '2026-10-25T07:00:00.000Z',
    );
  });
});

describe('isMailRunDue', () => {
  const now = new Date('2026-01-15T12:00:00.000Z'); // latest run: 07:00 UTC

  it('is due on the very first run', () => {
    expect(isMailRunDue(now, null)).toBe(true);
  });

  it('is not due when the last success is after the latest 08:00', () => {
    expect(isMailRunDue(now, new Date('2026-01-15T09:00:00.000Z'))).toBe(false);
  });

  it('is not due when the last success is exactly at the latest 08:00', () => {
    expect(isMailRunDue(now, new Date('2026-01-15T07:00:00.000Z'))).toBe(false);
  });

  it('is due one second before the latest 08:00', () => {
    expect(isMailRunDue(now, new Date('2026-01-15T06:59:59.000Z'))).toBe(true);
  });

  it('is due when the last success was yesterday', () => {
    expect(isMailRunDue(now, new Date('2026-01-14T10:00:00.000Z'))).toBe(true);
  });

  it('is not due before 08:00 when yesterday already succeeded after yesterday 08:00', () => {
    expect(
      isMailRunDue(new Date('2026-01-15T05:00:00.000Z'), new Date('2026-01-14T10:00:00.000Z')),
    ).toBe(false);
  });
});

describe('token expiry (Google testing mode)', () => {
  const issuedAt = new Date('2026-01-01T10:00:00.000Z');

  it('lives for seven days', () => {
    expect(TOKEN_LIFETIME_DAYS).toBe(7);
    expect(iso(tokenExpiresAt(issuedAt))).toBe('2026-01-08T10:00:00.000Z');
  });

  it('is valid with more than 24 hours left', () => {
    expect(tokenStatus(new Date('2026-01-07T09:59:59.000Z'), issuedAt, null)).toBe('valid');
  });

  it('is expiring with exactly 24 hours left', () => {
    expect(tokenStatus(new Date('2026-01-07T10:00:00.000Z'), issuedAt, null)).toBe('expiring');
  });

  it('is expiring just before the end', () => {
    expect(tokenStatus(new Date('2026-01-08T09:59:59.000Z'), issuedAt, null)).toBe('expiring');
  });

  it('is expired at seven days', () => {
    expect(tokenStatus(new Date('2026-01-08T10:00:00.000Z'), issuedAt, null)).toBe('expired');
  });

  it('is expired when an auth failure was recorded after the issue time', () => {
    expect(
      tokenStatus(
        new Date('2026-01-02T00:00:00.000Z'),
        issuedAt,
        new Date('2026-01-01T12:00:00.000Z'),
      ),
    ).toBe('expired');
  });

  it('ignores an auth failure from before the token was issued', () => {
    expect(
      tokenStatus(
        new Date('2026-01-02T00:00:00.000Z'),
        issuedAt,
        new Date('2025-12-31T12:00:00.000Z'),
      ),
    ).toBe('valid');
  });

  it('is expired on an auth failure even when the issue date is unknown', () => {
    expect(tokenStatus(new Date('2026-01-02T00:00:00.000Z'), null, new Date('2026-01-01T00:00:00.000Z'))).toBe(
      'expired',
    );
  });

  it('is unknown with no issue date and no failure', () => {
    expect(tokenStatus(new Date('2026-01-02T00:00:00.000Z'), null, null)).toBe('unknown');
  });
});

describe('isMailCheckAllowed (retry cooldown)', () => {
  const now = new Date('2026-06-10T10:00:00.000Z');
  const at = (offsetMs: number): string => new Date(now.getTime() + offsetMs).toISOString();
  const state = (lastAttemptAt: string | null, lastSuccessAt: string | null = null) => ({
    lastAttemptAt,
    lastSuccessAt,
  });

  it('uses a 30 minute cooldown', () => {
    expect(MAIL_RETRY_COOLDOWN_MS).toBe(30 * 60 * 1000);
  });

  it('allows when there was no attempt, or the attempt is unparseable', () => {
    expect(isMailCheckAllowed(now, state(null))).toBe(true);
    expect(isMailCheckAllowed(now, state('not a date'))).toBe(true);
    expect(isMailCheckAllowed(now, state(''))).toBe(true);
  });

  it('blocks a recent failed attempt and allows it exactly at the cooldown', () => {
    expect(isMailCheckAllowed(now, state(at(-MAIL_RETRY_COOLDOWN_MS + 1)))).toBe(false);
    expect(isMailCheckAllowed(now, state(at(-MAIL_RETRY_COOLDOWN_MS)))).toBe(true);
    expect(isMailCheckAllowed(now, state(at(-MAIL_RETRY_COOLDOWN_MS - 1)))).toBe(true);
    expect(isMailCheckAllowed(now, state(at(-1000)))).toBe(false);
  });

  it('lets force bypass the cooldown', () => {
    expect(isMailCheckAllowed(now, state(at(-1000)), { force: true })).toBe(true);
    expect(isMailCheckAllowed(now, state(at(-1000)), { force: false })).toBe(false);
  });

  it('does not block on a finished success', () => {
    expect(isMailCheckAllowed(now, state(at(-1000), at(-1000)))).toBe(true);
    expect(isMailCheckAllowed(now, state(at(-1000), at(500)))).toBe(true);
  });

  it('still blocks when the last success is older than the recent attempt', () => {
    expect(isMailCheckAllowed(now, state(at(-1000), at(-5000)))).toBe(false);
  });

  it('ignores an unparseable lastSuccessAt', () => {
    expect(isMailCheckAllowed(now, state(at(-1000), 'garbage'))).toBe(false);
  });

  it('treats a future attempt as blocked only until now reaches it plus the cooldown', () => {
    const future = at(60 * 60 * 1000);
    expect(isMailCheckAllowed(now, state(future))).toBe(false);
    const later = new Date(now.getTime() + 60 * 60 * 1000 + MAIL_RETRY_COOLDOWN_MS);
    expect(isMailCheckAllowed(later, state(future))).toBe(true);
    expect(isMailCheckAllowed(new Date(later.getTime() - 1), state(future))).toBe(false);
  });
});
