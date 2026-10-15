import { describe, expect, it } from 'vitest';
import { parseCliOptions } from '../../src/cli/options.js';

/**
 * `--source` has its own suite; this one is about every OTHER flag, and above
 * all about the one whose default was wrong.
 *
 * Option parsing used to live inside `main.ts`, which calls `main()` at import
 * time - so importing it from a test would have run the pipeline. That made the
 * defaults untestable, and an untested default is exactly how link resolution
 * stayed off while the documented command shipped 212 shortener links to the
 * apply buttons. The parser is a pure function in its own module now.
 */

describe('link resolution defaults', () => {
  it('RESOLVES BY DEFAULT: the documented command must not ship tracking links', () => {
    /*
     * The defect. `npm start -- --source=all` reported:
     *
     *   Newsletter links: 212 unique, 0 resolved to the employer's posting,
     *   212 kept as the original newsletter link.
     *
     * Every apply button was a `juniorjobs.short.gy/...` redirect, one of which
     * had already been observed answering 404. The safe default is the one that
     * gives the user the employer's own address.
     */
    expect(parseCliOptions(['--source=newsletter']).resolveLinks).toBe(true);
    expect(parseCliOptions([]).resolveLinks).toBe(true);
  });

  it('honours the explicit opt-out for an offline or quota-conscious run', () => {
    expect(parseCliOptions(['--no-resolve-links']).resolveLinks).toBe(false);
    expect(parseCliOptions(['--source=newsletter', '--no-resolve-links']).resolveLinks).toBe(false);
  });

  it('still accepts the old --resolve-links flag instead of rejecting a documented command', () => {
    // It is now a no-op, but a README, a shell history and a saved script all
    // still carry it. Erroring on it would break a command that asks for
    // precisely the behaviour that is now the default.
    expect(parseCliOptions(['--resolve-links']).resolveLinks).toBe(true);
  });

  it('lets the opt-out win when both flags are passed', () => {
    // The user typing the negative form last meant it. Silently preferring the
    // affirmative would send requests somebody explicitly asked us not to send.
    expect(parseCliOptions(['--resolve-links', '--no-resolve-links']).resolveLinks).toBe(false);
  });
});

/**
 * The liveness flag follows `--no-resolve-links` exactly, and for the same
 * reason: the useful behaviour is the default, and the opt-out exists for an
 * offline or quota-conscious run rather than for safety. Checking is safe by
 * construction - only 404 and 410 remove anything - so nobody needs to turn it
 * off to protect their list.
 */
describe('link liveness defaults', () => {
  it('CHECKS BY DEFAULT, so a dead posting is caught before it is clicked', () => {
    expect(parseCliOptions([]).checkLinks).toBe(true);
    expect(parseCliOptions(['--source=all']).checkLinks).toBe(true);
  });

  it('honours the explicit opt-out for an offline or quota-conscious run', () => {
    expect(parseCliOptions(['--no-check-links']).checkLinks).toBe(false);
    expect(parseCliOptions(['--source=all', '--no-check-links']).checkLinks).toBe(false);
  });

  it('lets the opt-out win when both forms are passed', () => {
    expect(parseCliOptions(['--check-links', '--no-check-links']).checkLinks).toBe(false);
  });

  it('accepts the affirmative form as a no-op rather than erroring on it', () => {
    expect(parseCliOptions(['--check-links']).checkLinks).toBe(true);
  });

  it('does not confuse the two independent opt-outs', () => {
    // `--no-resolve-links` and `--no-check-links` answer different questions:
    // "which address do we show?" and "is that address still serving?". Turning
    // one off must not quietly turn the other off.
    const noResolve = parseCliOptions(['--no-resolve-links']);
    expect(noResolve.resolveLinks).toBe(false);
    expect(noResolve.checkLinks).toBe(true);

    const noCheck = parseCliOptions(['--no-check-links']);
    expect(noCheck.resolveLinks).toBe(true);
    expect(noCheck.checkLinks).toBe(false);
  });

  it('defaults the liveness cache next to the data, not inside output/', () => {
    // `output/` is disposable and git-ignored. The record of which postings
    // were deleted, and why, is not.
    expect(parseCliOptions([]).livenessCachePath).toMatch(/[\\/]data[\\/]\.link-liveness\.json$/);
  });

  it('lets the cache path be overridden so a run can be inspected in isolation', () => {
    expect(parseCliOptions(['--liveness-cache=/tmp/scratch.json']).livenessCachePath).toBe(
      '/tmp/scratch.json',
    );
  });
});

describe('the rest of the options', () => {
  it('keeps every other default exactly where it was', () => {
    const options = parseCliOptions([]);

    expect(options.sources).toEqual(['fixture']);
    expect(options.limit).toBeUndefined();
    expect(options.explain).toBe(3);
  });

  it('reads the value flags', () => {
    const options = parseCliOptions([
      '--source=boards',
      '--limit=5',
      '--explain=0',
      '--concurrency=2',
      '--timeout=1000',
      '--out=/tmp/q.json',
      '--fixture=/tmp/f.json',
      '--applications=/tmp/a.json',
      '--newsletters=/tmp/n',
      '--link-cache=/tmp/c.json',
    ]);

    expect(options.limit).toBe(5);
    expect(options.explain).toBe(0);
    expect(options.concurrency).toBe(2);
    expect(options.timeoutMs).toBe(1000);
    expect(options.outputPath).toBe('/tmp/q.json');
    expect(options.fixturePath).toBe('/tmp/f.json');
    expect(options.applicationLogPath).toBe('/tmp/a.json');
    expect(options.newsletterDir).toBe('/tmp/n');
    expect(options.linkCachePath).toBe('/tmp/c.json');
  });

  it('rejects a negative or non-numeric count rather than running with a guess', () => {
    expect(() => parseCliOptions(['--limit=-1'])).toThrow(/--limit/);
    expect(() => parseCliOptions(['--explain=many'])).toThrow(/--explain/);
  });

  it('refuses to mix the sample catalogue into a real run', () => {
    expect(() => parseCliOptions(['--source=all,fixture'])).toThrow(/fixture/);
  });
});
