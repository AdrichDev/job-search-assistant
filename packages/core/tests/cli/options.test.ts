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
    ]);

    expect(options.limit).toBe(5);
    expect(options.explain).toBe(0);
    expect(options.concurrency).toBe(2);
    expect(options.timeoutMs).toBe(1000);
    expect(options.outputPath).toBe('/tmp/q.json');
    expect(options.fixturePath).toBe('/tmp/f.json');
    expect(options.applicationLogPath).toBe('/tmp/a.json');
  });

  it('rejects a negative or non-numeric count rather than running with a guess', () => {
    expect(() => parseCliOptions(['--limit=-1'])).toThrow(/--limit/);
    expect(() => parseCliOptions(['--explain=many'])).toThrow(/--explain/);
  });

  it('refuses to mix the sample catalogue into a real run', () => {
    expect(() => parseCliOptions(['--source=all,fixture'])).toThrow(/fixture/);
  });
});
