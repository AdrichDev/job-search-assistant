import { describe, expect, it } from 'vitest';
import {
  GONE_STATUS_CODES,
  describeLivenessRemoval,
  isProvablyGone,
  judgeLiveness,
  type LivenessRecord,
} from '../../src/domain/link-liveness.js';

/**
 * THE REMOVAL RULE, and the asymmetry it exists to encode.
 *
 * A dead link the candidate clicks past costs five seconds. A real vacancy
 * silently deleted is invisible and unrecoverable. So the two directions of
 * this rule are NOT tested symmetrically by accident - the "keeps" table below
 * is deliberately much longer than the "removes" one, because every row in it
 * is a way a healthy posting could be destroyed by a checker that mistook an
 * unfriendly server for a dead vacancy.
 */

const CHECKED_AT = '2026-09-10T08:00:00.000Z';

function record(status: number | null, error: string | null = null): LivenessRecord {
  return { verdict: judgeLiveness({ status, error }), status, checkedAt: CHECKED_AT, error };
}

describe('the gone list', () => {
  it('is exactly 404 and 410, and nothing else', () => {
    // Pinned as a set rather than asserted per-code, so widening the rule
    // cannot happen quietly in a refactor.
    expect([...GONE_STATUS_CODES].sort((a, b) => a - b)).toEqual([404, 410]);
  });
});

describe('what is provably gone', () => {
  it.each([
    [404, 'the posting was removed'],
    [410, 'the employer said explicitly that it is gone'],
  ])('removes on HTTP %i (%s)', (status) => {
    expect(judgeLiveness({ status, error: null })).toBe('gone');
    expect(isProvablyGone(record(status))).toBe(true);
  });
});

describe('what is kept, because it is not evidence of death', () => {
  /*
   * Every entry here was chosen because a naive "not 2xx means dead" checker
   * would delete it.
   */
  it.each([
    [403, 'bot protection - the server dislikes US, it says nothing about the vacancy'],
    [401, 'the posting is behind a login, not absent'],
    [429, 'rate limiting - we asked too often, that is our fault not the job\'s'],
    [302, 'a redirect is a working link, not a missing one'],
    [301, 'a permanent redirect still leads somewhere'],
    [307, 'a temporary redirect still leads somewhere'],
    [500, 'the server is broken today; the posting may be fine tomorrow'],
    [503, 'maintenance window'],
    [418, 'an unknown 4xx is unknown, not gone'],
  ])('keeps HTTP %i (%s)', (status) => {
    expect(judgeLiveness({ status, error: null })).toBe('unverified');
    expect(isProvablyGone(record(status))).toBe(false);
  });

  it.each([
    ['request timed out after 10000ms'],
    ['read ECONNRESET'],
    ['getaddrinfo ENOTFOUND careers.example-employer.com'],
    ['fetch failed'],
    ['socket hang up'],
    ['unable to verify the first certificate'],
  ])('keeps a posting whose check failed with "%s"', (error) => {
    expect(judgeLiveness({ status: null, error })).toBe('unverified');
    expect(isProvablyGone(record(null, error))).toBe(false);
  });

  it('keeps a posting that was never checked at all', () => {
    // `null` is the state of every posting when checking is off. An unchecked
    // link must never read as a dead one.
    expect(isProvablyGone(null)).toBe(false);
    expect(isProvablyGone(undefined)).toBe(false);
  });

  it('keeps a posting when a status and an error disagree', () => {
    /*
     * A checker that reports both did not complete a clean request, so the
     * status is not trustworthy. The tie breaks towards keeping - which is the
     * only direction that cannot destroy a real vacancy.
     */
    expect(judgeLiveness({ status: 404, error: 'read ECONNRESET' })).toBe('unverified');
    expect(isProvablyGone(record(404, 'read ECONNRESET'))).toBe(false);
  });
});

describe('what counts as reachable', () => {
  it.each([200, 201, 204, 206])('reads HTTP %i as alive', (status) => {
    expect(judgeLiveness({ status, error: null })).toBe('alive');
    expect(isProvablyGone(record(status))).toBe(false);
  });
});

/**
 * THE NAMED REGRESSION.
 *
 * Both of these are real, currently-open junior vacancies at CaixaBank Tech
 * that the candidate is qualified for. They were measured on 2026-09-10:
 *
 *   https://jobs.example.test/2LZYe1 -> caixabanktech.com/es/job/junior-software-engineer-full-stack/
 *   https://jobs.example.test/P0VA3R -> caixabanktech.com/es/job/junior-software-engineer-java-python/
 *
 * The shortener answers 302. Following it, `caixabanktech.com` answers Node's
 * fetch with `read ECONNRESET` - to HEAD and to GET alike - while a browser and
 * curl reach the posting normally. That is bot protection, and it is the single
 * most dangerous input this rule will ever see: a checker that treated a reset
 * connection, or a bare 302, as death would delete two live opportunities and
 * leave no trace that they had ever been in the list.
 */
describe('the CaixaBank Tech regression', () => {
  const CAIXABANK = [
    { title: 'Software Engineer Full Stack (Junior)', url: 'https://jobs.example.test/2LZYe1' },
    { title: 'Software Engineer Java + Python (Junior)', url: 'https://jobs.example.test/P0VA3R' },
  ];

  it.each(CAIXABANK)('keeps "$title" when the shortener answers 302', ({ url }) => {
    expect(url).toContain('example.test');
    expect(isProvablyGone(record(302))).toBe(false);
  });

  it.each(CAIXABANK)('keeps "$title" when the destination resets the connection', () => {
    expect(isProvablyGone(record(null, 'read ECONNRESET'))).toBe(false);
  });

  it.each(CAIXABANK)('marks "$title" as unverified rather than alive or gone', () => {
    // Kept, but honestly labelled: the UI shows "no pudimos verificar este
    // enlace" rather than pretending the check succeeded.
    expect(record(null, 'read ECONNRESET').verdict).toBe('unverified');
  });
});

describe('the removal reason written into the audit trail', () => {
  it('names the status and says what it proves', () => {
    expect(describeLivenessRemoval(record(404))).toBe(
      'the posting answered HTTP 404 (gone), so the vacancy no longer exists at that address',
    );
  });

  it('names 410 distinctly, because the employer said it explicitly', () => {
    expect(describeLivenessRemoval(record(410))).toBe(
      'the posting answered HTTP 410 (gone), so the vacancy no longer exists at that address',
    );
  });

  it('refuses to describe a removal that the rule would not make', () => {
    // Guards against a caller writing "removed" into the excluded table for a
    // posting this module never condemned.
    expect(() => describeLivenessRemoval(record(403))).toThrow(/only 404 and 410/i);
  });
});
