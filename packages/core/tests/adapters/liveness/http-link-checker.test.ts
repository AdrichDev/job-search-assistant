import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVENESS_TTL_MS,
  DEFAULT_LIVENESS_UNVERIFIED_TTL_MS,
  createHttpLinkChecker,
  type LinkCheckFetch,
  type LivenessCache,
} from '../../../src/adapters/liveness/http-link-checker.js';
import { createRecordingLogger, silentLogger } from '../../helpers/silent-logger.js';

/**
 * The liveness checker: the only NEW traffic this change introduces, and the
 * fence around it.
 *
 * Not one test here touches the network - same rule as the link resolver's
 * suite. A checker test that reached `amazon.jobs` would fail on a train and
 * would also be the project quietly doing the crawling it promised not to do.
 *
 * Two things are being pinned:
 *
 *   1. POLITENESS. HEAD only, one request per unique URL, bounded concurrency,
 *      a hard timeout, and a disk cache with a TTL so a repeat run is nearly
 *      free. This is somebody else's careers page.
 *   2. WHAT MAY BE REMEMBERED. A verdict may be cached. A bad minute on the
 *      network may not - persisting a timeout as if it were an answer is how a
 *      transient failure becomes a permanent deletion.
 */

const NOW = new Date('2026-09-10T08:00:00.000Z');

function memoryCache(seed: Record<string, unknown> = {}): LivenessCache & {
  readonly writes: Record<string, unknown>[];
  current: Record<string, unknown>;
} {
  const writes: Record<string, unknown>[] = [];
  const box = {
    writes,
    current: { ...seed } as Record<string, unknown>,
    async load(): Promise<unknown> {
      return box.current;
    },
    async save(entries: Readonly<Record<string, unknown>>): Promise<void> {
      box.current = { ...entries };
      writes.push({ ...entries });
    },
  };
  return box as LivenessCache & { readonly writes: Record<string, unknown>[]; current: Record<string, unknown> };
}

interface Call {
  readonly url: string;
  readonly method: string;
}

/** A fetch double that records every call, so politeness is assertable. */
function recordingFetch(
  handler: (url: string, method: string) => { status: number } | Error,
): LinkCheckFetch & { readonly calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    const outcome = handler(url, init.method);
    if (outcome instanceof Error) {
      throw outcome;
    }
    return { status: outcome.status, url };
  };
  return Object.assign(impl, { calls });
}

function checker(
  fetchImpl: LinkCheckFetch,
  cache: LivenessCache,
  overrides: { now?: () => Date; concurrency?: number; timeoutMs?: number; ttlMs?: number } = {},
) {
  return createHttpLinkChecker({
    fetchImpl,
    cache,
    logger: silentLogger,
    now: overrides.now ?? (() => NOW),
    concurrency: overrides.concurrency ?? 2,
    timeoutMs: overrides.timeoutMs ?? 1_000,
    ...(overrides.ttlMs === undefined ? {} : { ttlMs: overrides.ttlMs }),
  });
}

describe('politeness', () => {
  it('makes no request at all when there is nothing to check', async () => {
    const fetchImpl = recordingFetch(() => ({ status: 200 }));
    const result = await checker(fetchImpl, memoryCache()).check([]);

    expect(result.size).toBe(0);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('asks with HEAD and never with GET when the server accepts HEAD', async () => {
    const fetchImpl = recordingFetch(() => ({ status: 200 }));
    await checker(fetchImpl, memoryCache()).check(['https://example.org/a']);

    expect(fetchImpl.calls).toEqual([{ url: 'https://example.org/a', method: 'HEAD' }]);
  });

  it('issues ONE request per unique URL even when a posting repeats', async () => {
    const fetchImpl = recordingFetch(() => ({ status: 200 }));
    await checker(fetchImpl, memoryCache()).check([
      'https://example.org/a',
      'https://example.org/a',
      'https://example.org/a',
    ]);

    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: LinkCheckFetch = async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { status: 200, url };
    };

    const urls = Array.from({ length: 12 }, (_, i) => `https://example.org/${i}`);
    await checker(fetchImpl, memoryCache(), { concurrency: 3 }).check(urls);

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('retries once with GET when the server refuses HEAD with 405', async () => {
    const fetchImpl = recordingFetch((_url, method) =>
      method === 'HEAD' ? { status: 405 } : { status: 200 },
    );
    const result = await checker(fetchImpl, memoryCache()).check(['https://example.org/a']);

    expect(fetchImpl.calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);
    expect(result.get('https://example.org/a')?.verdict).toBe('alive');
  });

  it('retries once with GET when HEAD is refused by resetting the connection', async () => {
    const fetchImpl = recordingFetch((_url, method) =>
      method === 'HEAD' ? new Error('read ECONNRESET') : { status: 200 },
    );
    const result = await checker(fetchImpl, memoryCache()).check(['https://example.org/a']);

    expect(fetchImpl.calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);
    expect(result.get('https://example.org/a')?.verdict).toBe('alive');
  });

  it('stops after the single GET retry rather than becoming a crawler', async () => {
    const fetchImpl = recordingFetch(() => new Error('read ECONNRESET'));
    await checker(fetchImpl, memoryCache()).check(['https://example.org/a']);

    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('still stops at two requests when the 405 retry itself fails', async () => {
    /*
     * The path that is easy to get wrong: HEAD answers 405, the GET retry is
     * attempted, the GET fails, and a naive `catch` retries GET a second time.
     * Three requests to a server that has already failed twice is exactly the
     * behaviour the one-retry rule forbids.
     */
    const fetchImpl = recordingFetch((_url, method) =>
      method === 'HEAD' ? { status: 405 } : new Error('read ECONNRESET'),
    );
    const result = await checker(fetchImpl, memoryCache()).check(['https://example.org/a']);

    expect(fetchImpl.calls.map((call) => call.method)).toEqual(['HEAD', 'GET']);
    expect(result.get('https://example.org/a')?.verdict).toBe('unverified');
  });

  it('gives up on a hanging server and reports the timeout as unverified', async () => {
    const fetchImpl: LinkCheckFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });

    const result = await checker(fetchImpl, memoryCache(), { timeoutMs: 10 }).check([
      'https://example.org/slow',
    ]);

    const record = result.get('https://example.org/slow');
    expect(record?.verdict).toBe('unverified');
    expect(record?.error).toMatch(/timed out after 10ms/);
  });
});

describe('the verdicts it produces', () => {
  it.each([
    [404, 'gone'],
    [410, 'gone'],
    [200, 'alive'],
    [403, 'unverified'],
    [429, 'unverified'],
    [302, 'unverified'],
    [500, 'unverified'],
  ])('reads HTTP %i as %s', async (status, verdict) => {
    const result = await checker(recordingFetch(() => ({ status })), memoryCache()).check([
      'https://example.org/a',
    ]);

    expect(result.get('https://example.org/a')?.verdict).toBe(verdict);
    expect(result.get('https://example.org/a')?.status).toBe(status);
  });

  it('reads a connection reset as unverified, never as gone', async () => {
    // The CaixaBank Tech case, at the adapter boundary.
    const result = await checker(
      recordingFetch(() => new Error('read ECONNRESET')),
      memoryCache(),
    ).check(['https://caixabanktech.com/es/job/junior-software-engineer-full-stack/']);

    const record = result.get('https://caixabanktech.com/es/job/junior-software-engineer-full-stack/');
    expect(record?.verdict).toBe('unverified');
    expect(record?.status).toBeNull();
    expect(record?.error).toBe('read ECONNRESET');
  });

  it('stamps every record with when it was checked', async () => {
    const result = await checker(recordingFetch(() => ({ status: 200 })), memoryCache()).check([
      'https://example.org/a',
    ]);

    expect(result.get('https://example.org/a')?.checkedAt).toBe(NOW.toISOString());
  });
});

describe('the disk cache', () => {
  it('issues NO requests on a second run minutes later', async () => {
    const cache = memoryCache();
    const first = recordingFetch(() => ({ status: 200 }));
    const urls = ['https://example.org/a', 'https://example.org/b', 'https://example.org/c'];

    await checker(first, cache).check(urls);
    expect(first.calls).toHaveLength(3);

    const minutesLater = new Date(NOW.getTime() + 5 * 60_000);
    const second = recordingFetch(() => {
      throw new Error('the second run must not touch the network');
    });
    const result = await checker(second, cache, { now: () => minutesLater }).check(urls);

    expect(second.calls).toHaveLength(0);
    expect(result.get('https://example.org/a')?.verdict).toBe('alive');
  });

  it('reports how much of the second run came from the cache', async () => {
    const cache = memoryCache();
    await checker(recordingFetch(() => ({ status: 200 })), cache).check(['https://example.org/a']);

    const second = checker(recordingFetch(() => ({ status: 200 })), cache, {
      now: () => new Date(NOW.getTime() + 60_000),
    });
    await second.check(['https://example.org/a', 'https://example.org/new']);

    expect(second.takeStats?.()).toEqual({ requests: 1, fromCache: 1 });
  });

  it('re-checks a verdict once its TTL has expired', async () => {
    const cache = memoryCache();
    await checker(recordingFetch(() => ({ status: 200 })), cache).check(['https://example.org/a']);

    const stale = new Date(NOW.getTime() + DEFAULT_LIVENESS_TTL_MS + 1_000);
    const second = recordingFetch(() => ({ status: 404 }));
    const result = await checker(second, cache, { now: () => stale }).check([
      'https://example.org/a',
    ]);

    expect(second.calls).toHaveLength(1);
    expect(result.get('https://example.org/a')?.verdict).toBe('gone');
  });

  it('re-checks an unverified posting far sooner than a settled verdict', async () => {
    /*
     * A 403 is not an answer about the vacancy, so it must not be trusted for
     * as long as one. It is remembered only long enough to stop a burst of runs
     * hammering a server that has already told us to go away.
     */
    expect(DEFAULT_LIVENESS_UNVERIFIED_TTL_MS).toBeLessThan(DEFAULT_LIVENESS_TTL_MS);

    const cache = memoryCache();
    await checker(recordingFetch(() => ({ status: 403 })), cache).check(['https://example.org/a']);

    const later = new Date(NOW.getTime() + DEFAULT_LIVENESS_UNVERIFIED_TTL_MS + 1_000);
    const second = recordingFetch(() => ({ status: 200 }));
    await checker(second, cache, { now: () => later }).check(['https://example.org/a']);

    expect(second.calls).toHaveLength(1);
  });

  it('NEVER remembers a network failure as if it were a verdict', async () => {
    /*
     * The rule this whole file exists to protect. A timeout cached for twelve
     * hours would freeze a healthy posting as unverified - or, in a checker
     * written slightly differently, delete it - because of one bad minute of
     * wifi.
     */
    const cache = memoryCache();
    await checker(
      recordingFetch(() => new Error('getaddrinfo ENOTFOUND careers.example.org')),
      cache,
    ).check(['https://careers.example.org/a']);

    expect(cache.current).toEqual({});
    expect(cache.writes).toEqual([]);
  });

  it('NEVER remembers a timeout as if it were a verdict', async () => {
    const cache = memoryCache();
    const hanging: LinkCheckFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });

    await checker(hanging, cache, { timeoutMs: 10 }).check(['https://example.org/slow']);

    expect(cache.current).toEqual({});
  });

  it('remembers a gone verdict, so a dead posting stays removed for free', async () => {
    const cache = memoryCache();
    await checker(recordingFetch(() => ({ status: 404 })), cache).check(['https://example.org/a']);

    expect(cache.current).toEqual({
      'https://example.org/a': {
        verdict: 'gone',
        status: 404,
        checkedAt: NOW.toISOString(),
      },
    });
  });

  it('resolves from scratch when the cache file is corrupt, rather than failing the run', async () => {
    const logger = createRecordingLogger();
    const fetchImpl = recordingFetch(() => ({ status: 200 }));
    const result = await createHttpLinkChecker({
      fetchImpl,
      cache: memoryCache({ 'https://example.org/a': 'not an object at all' }),
      logger,
      now: () => NOW,
      concurrency: 2,
      timeoutMs: 1_000,
    }).check(['https://example.org/a']);

    expect(fetchImpl.calls).toHaveLength(1);
    expect(result.get('https://example.org/a')?.verdict).toBe('alive');
  });

  it('survives a cache it cannot write, because a run is worth more than its cache', async () => {
    const logger = createRecordingLogger();
    const unwritable: LivenessCache = {
      async load() {
        return {};
      },
      async save() {
        throw new Error('EACCES: permission denied');
      },
    };

    const result = await createHttpLinkChecker({
      fetchImpl: recordingFetch(() => ({ status: 404 })),
      cache: unwritable,
      logger,
      now: () => NOW,
      concurrency: 2,
      timeoutMs: 1_000,
    }).check(['https://example.org/a']);

    expect(result.get('https://example.org/a')?.verdict).toBe('gone');
    const warnings = logger.messages.filter((entry) => entry.level === 'warn');
    expect(warnings.map((entry) => entry.message).join('\n')).toMatch(
      /could not write the liveness cache/i,
    );
  });
});

describe('when the checker fails wholesale', () => {
  it('returns every posting as unverified rather than as gone', async () => {
    // No network at all: every request throws. Nothing here is evidence that a
    // single vacancy has closed.
    const urls = ['https://example.org/a', 'https://example.org/b', 'https://example.org/c'];
    const result = await checker(
      recordingFetch(() => new Error('fetch failed')),
      memoryCache(),
    ).check(urls);

    expect([...result.values()].map((record) => record.verdict)).toEqual([
      'unverified',
      'unverified',
      'unverified',
    ]);
  });

  it('writes nothing to the cache, so the next run starts clean', async () => {
    const cache = memoryCache();
    await checker(recordingFetch(() => new Error('fetch failed')), cache).check([
      'https://example.org/a',
    ]);

    expect(cache.current).toEqual({});
  });
});
