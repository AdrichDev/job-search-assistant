import { describe, expect, it } from 'vitest';
import {
  classifyRunHealth,
  decideQueueWrite,
  persistQueue,
  type ExistingQueueState,
  type PersistQueueDeps,
} from '../../src/app/persist-queue.js';
import type { JobQueue, QueueEntry, SourceReport } from '../../src/ports/queue-writer.js';
import { createRecordingLogger } from '../helpers/silent-logger.js';
import { REFERENCE_NOW } from '../helpers/make-job.js';

/**
 * The data-loss regression suite.
 *
 * Context: a real run hit HTTP 429 on every generic aggregator query, collected nothing,
 * printed "Degraded run" - and then wrote an empty queue over 25 real postings.
 *
 * The rule these tests pin down is one sentence:
 *
 *   An empty result may only replace a non-empty queue when EVERY source query
 *   succeeded.
 *
 * Emptiness is a trustworthy fact only when nothing failed. Otherwise it is
 * indistinguishable from "the queries that had the jobs are the ones that died",
 * and destroying real history to record a guess is the wrong trade.
 */

function report(status: 'ok' | 'failed', query: string, fetched = 0): SourceReport {
  return {
    sourceId: 'aggregator',
    query,
    status,
    fetched,
    ...(status === 'failed' ? { error: 'generic aggregator request failed with HTTP 429 (page 1)' } : {}),
  };
}

function entry(id: string): QueueEntry {
  return {
    rank: 1,
    id,
    score: 80,
    cvVariant: 'frontend',
    requirements: {
      yearsRequired: null,
      senioritySignals: [],
      matchedStack: [],
      cvVariant: 'frontend',
      englishRequired: 'not_stated',
      workMode: 'unknown',
    },
    applicationStatus: 'not_applied',
    appliedAt: null,
    outcomeUpdatedAt: null,
    notes: null,
    title: 'Junior Developer',
    company: 'ACME',
    location: 'Madrid',
    url: `https://example.test/${id}`,
    postedAt: REFERENCE_NOW.toISOString(),
    salaryMin: null,
    salaryMax: null,
    contractType: null,
    sources: [],
    breakdown: [],
    // Not checked. Every fixture here predates liveness and makes no claim.
    liveness: null,
  };
}

function queue(jobs: readonly QueueEntry[], reports: readonly SourceReport[]): JobQueue {
  return {
    generatedAt: REFERENCE_NOW.toISOString(),
    candidate: 'Alex Example',
    totalFetched: jobs.length,
    totalUnique: jobs.length,
    totalRelevant: jobs.length,
    totalJuniorEligible: jobs.length,
    duplicatesRemoved: 0,
    sourceReports: reports,
    excluded: [],
    jobs,
  };
}

/** 25 real postings sitting on disk - the thing the defect destroyed. */
const GOOD_QUEUE = queue(
  Array.from({ length: 25 }, (_, index) => entry(`job-${index}`)),
  [report('ok', 'junior developer', 25)],
);

interface Recorder {
  readonly deps: PersistQueueDeps;
  readonly written: JobQueue[];
  readonly logger: ReturnType<typeof createRecordingLogger>;
}

function recorder(existing: JobQueue | null | (() => never)): Recorder {
  const written: JobQueue[] = [];
  const logger = createRecordingLogger();

  return {
    written,
    logger,
    deps: {
      reader: {
        read: async () => {
          if (typeof existing === 'function') {
            return existing();
          }
          return existing;
        },
      },
      writer: {
        write: async (value: JobQueue) => {
          written.push(value);
          return '/tmp/output/queue.json';
        },
      },
      logger,
    },
  };
}

describe('classifyRunHealth', () => {
  it('is healthy when every query succeeded', () => {
    expect(classifyRunHealth([report('ok', 'a'), report('ok', 'b')])).toBe('healthy');
  });

  it('is healthy when no source was attempted at all', () => {
    expect(classifyRunHealth([])).toBe('healthy');
  });

  it('is sources_failed when every query failed', () => {
    expect(classifyRunHealth([report('failed', 'a'), report('failed', 'b')])).toBe(
      'sources_failed',
    );
  });

  it('is degraded when some queries failed and some succeeded', () => {
    expect(classifyRunHealth([report('failed', 'a'), report('ok', 'b')])).toBe('degraded');
  });
});

describe('decideQueueWrite', () => {
  const ABSENT: ExistingQueueState = { kind: 'absent' };

  it('refuses to replace a good queue when every source failed', () => {
    const decision = decideQueueWrite({
      sourceReports: [report('failed', 'a'), report('failed', 'b')],
      incomingJobCount: 0,
      existing: { kind: 'present', jobCount: 25 },
    });

    expect(decision.action).toBe('refuse');
    expect(decision.health).toBe('sources_failed');
  });

  it('writes an empty result when every source failed but there is nothing to protect', () => {
    const decision = decideQueueWrite({
      sourceReports: [report('failed', 'a')],
      incomingJobCount: 0,
      existing: ABSENT,
    });

    expect(decision.action).toBe('write');
  });

  it('writes a legitimately empty result when every source succeeded', () => {
    const decision = decideQueueWrite({
      sourceReports: [report('ok', 'a'), report('ok', 'b')],
      incomingJobCount: 0,
      existing: { kind: 'present', jobCount: 25 },
    });

    expect(decision.action).toBe('write');
    expect(decision.health).toBe('healthy');
  });

  /*
   * The judgement call, and the exact shape of the observed incident: 2 of 7
   * queries died with 429, the other 5 returned nothing, 0 postings collected,
   * 25 real postings on disk. A rule that only fires on TOTAL failure would
   * have let this run destroy the data all over again.
   */
  it('refuses when a partially degraded run produced nothing and a good queue exists', () => {
    const decision = decideQueueWrite({
      sourceReports: [
        report('failed', 'junior developer'),
        report('ok', 'desarrollador junior'),
        report('ok', 'programador junior'),
        report('ok', 'react javascript'),
        report('failed', 'power platform'),
        report('ok', 'business central navision'),
        report('ok', 'becario desarrollo software'),
      ],
      incomingJobCount: 0,
      existing: { kind: 'present', jobCount: 25 },
    });

    expect(decision.action).toBe('refuse');
    expect(decision.health).toBe('degraded');
  });

  /*
   * The other half of the same judgement: a flaky query must not permanently
   * block updates. Usable data was produced, so it is written - loudly.
   */
  it('writes a partially degraded run that still produced postings, with a warning', () => {
    const decision = decideQueueWrite({
      sourceReports: [report('failed', 'a'), report('ok', 'b', 24)],
      incomingJobCount: 24,
      existing: { kind: 'present', jobCount: 25 },
    });

    expect(decision.action).toBe('write');
    expect(decision.health).toBe('degraded');
    if (decision.action !== 'write') {
      throw new Error('unreachable');
    }
    expect(decision.warnings.join(' ')).toContain('1 of 2');
  });

  it('protects a queue file it could not read rather than assuming it is empty', () => {
    const decision = decideQueueWrite({
      sourceReports: [report('failed', 'a')],
      incomingJobCount: 0,
      existing: { kind: 'unreadable', reason: 'not valid JSON' },
    });

    expect(decision.action).toBe('refuse');
  });

  it('overwrites an existing queue that is itself empty', () => {
    const decision = decideQueueWrite({
      sourceReports: [report('failed', 'a')],
      incomingJobCount: 0,
      existing: { kind: 'present', jobCount: 0 },
    });

    expect(decision.action).toBe('write');
  });
});

describe('persistQueue', () => {
  it('leaves 25 real postings on disk when every source query failed', async () => {
    const context = recorder(GOOD_QUEUE);
    const incoming = queue([], [report('failed', 'a'), report('failed', 'b')]);

    const result = await persistQueue(incoming, context.deps);

    expect(result.status).toBe('refused');
    expect(context.written).toEqual([]);
  });

  it('explains the refusal loudly instead of failing silently', async () => {
    const context = recorder(GOOD_QUEUE);

    const result = await persistQueue(queue([], [report('failed', 'a')]), context.deps);

    if (result.status !== 'refused') {
      throw new Error('expected a refusal');
    }
    expect(result.reason).toContain('25');
    expect(context.logger.messages.some((line) => line.level === 'error')).toBe(true);
  });

  it('writes when no previous queue exists, even though the run failed', async () => {
    const context = recorder(null);
    const incoming = queue([], [report('failed', 'a')]);

    const result = await persistQueue(incoming, context.deps);

    expect(result.status).toBe('written');
    expect(context.written).toHaveLength(1);
  });

  it('writes a genuinely empty result produced by healthy sources', async () => {
    const context = recorder(GOOD_QUEUE);
    const incoming = queue([], [report('ok', 'a'), report('ok', 'b')]);

    const result = await persistQueue(incoming, context.deps);

    expect(result.status).toBe('written');
    expect(context.written).toHaveLength(1);
    expect(context.written[0]?.jobs).toEqual([]);
  });

  it('never conflates a failed run with an empty market', async () => {
    const failed = await persistQueue(queue([], [report('failed', 'a')]), recorder(GOOD_QUEUE).deps);
    const empty = await persistQueue(queue([], [report('ok', 'a')]), recorder(GOOD_QUEUE).deps);

    expect(failed.status).toBe('refused');
    expect(empty.status).toBe('written');
  });

  it('writes a degraded run that produced postings and warns about it', async () => {
    const context = recorder(GOOD_QUEUE);
    const incoming = queue([entry('fresh')], [report('failed', 'a'), report('ok', 'b', 1)]);

    const result = await persistQueue(incoming, context.deps);

    expect(result.status).toBe('written');
    if (result.status !== 'written') {
      throw new Error('unreachable');
    }
    expect(result.health).toBe('degraded');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(context.logger.messages.some((line) => line.level === 'warn')).toBe(true);
  });

  it('refuses rather than overwriting a queue file it cannot parse', async () => {
    const context = recorder(() => {
      throw new Error('The queue file is not valid JSON.');
    });

    const result = await persistQueue(queue([], [report('failed', 'a')]), context.deps);

    expect(result.status).toBe('refused');
    expect(context.written).toEqual([]);
  });

  it('still writes healthy results when the previous queue file is unreadable', async () => {
    const context = recorder(() => {
      throw new Error('The queue file is not valid JSON.');
    });

    const result = await persistQueue(queue([entry('a')], [report('ok', 'a', 1)]), context.deps);

    expect(result.status).toBe('written');
  });
});
