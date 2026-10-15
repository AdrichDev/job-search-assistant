import { describe, expect, it } from 'vitest';
import {
  EXIT_OK,
  EXIT_RUN_FAILED,
  EXIT_WRITE_REFUSED,
  exitCodeFor,
} from '../../src/cli/exit-code.js';
import type { PersistQueueResult } from '../../src/app/persist-queue.js';

/**
 * The exit code is the only part of the run a script can read.
 *
 * "I refused to write, your data is intact" and "I wrote, but every source was
 * dead" are different facts with different remedies, so they get different
 * codes rather than being collapsed into a generic failure.
 */

describe('exitCodeFor', () => {
  it('reports success for a healthy run that was written', () => {
    const result: PersistQueueResult = {
      status: 'written',
      path: '/tmp/queue.json',
      health: 'healthy',
      warnings: [],
    };
    expect(exitCodeFor(result)).toBe(EXIT_OK);
  });

  it('reports a distinct code when the queue write was refused', () => {
    const result: PersistQueueResult = {
      status: 'refused',
      health: 'sources_failed',
      reason: 'every source query failed',
      preservedJobCount: 25,
    };

    expect(exitCodeFor(result)).toBe(EXIT_WRITE_REFUSED);
    expect(EXIT_WRITE_REFUSED).not.toBe(EXIT_OK);
    expect(EXIT_WRITE_REFUSED).not.toBe(EXIT_RUN_FAILED);
  });

  it('reports a refusal even when only some queries failed', () => {
    const result: PersistQueueResult = {
      status: 'refused',
      health: 'degraded',
      reason: 'a degraded run produced nothing',
      preservedJobCount: 25,
    };
    expect(exitCodeFor(result)).toBe(EXIT_WRITE_REFUSED);
  });

  it('reports failure when every source died but the queue was still written', () => {
    const result: PersistQueueResult = {
      status: 'written',
      path: '/tmp/queue.json',
      health: 'sources_failed',
      warnings: ['every source query failed'],
    };
    expect(exitCodeFor(result)).toBe(EXIT_RUN_FAILED);
  });

  /*
   * A single flaky query must not make `npm start` look broken to a wrapper
   * script: usable data WAS produced and written. The degradation is reported
   * in the run summary, which is where a human reads it.
   */
  it('reports success for a degraded run that still produced a usable queue', () => {
    const result: PersistQueueResult = {
      status: 'written',
      path: '/tmp/queue.json',
      health: 'degraded',
      warnings: ['1 of 7 source queries failed'],
    };
    expect(exitCodeFor(result)).toBe(EXIT_OK);
  });
});
