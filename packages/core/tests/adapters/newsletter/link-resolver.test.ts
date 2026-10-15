import { describe, expect, it, vi } from 'vitest';
import {
  createPassthroughLinkResolver,
  createRedirectLinkResolver,
  type LinkFetch,
  type LinkResolutionCache,
} from '../../../src/adapters/newsletter/link-resolver.js';
import { createRecordingLogger, silentLogger } from '../../helpers/silent-logger.js';

/**
 * Redirect resolution: the ONE piece of network traffic this adapter is allowed
 * to make, and the rules that keep it from becoming scraping.
 *
 * Not one test here touches the network. A resolver test that reached
 * `short.gy` would be a resolver test that fails on a train, and it would also
 * be the project quietly doing the thing it promised not to do.
 */

const NOW = new Date('2026-09-08T08:00:00.000Z');

function memoryCache(seed: Record<string, unknown> = {}): LinkResolutionCache & {
  saved: Record<string, unknown>[];
} {
  const saved: Record<string, unknown>[] = [];
  let current: Record<string, unknown> = { ...seed };
  return {
    saved,
    async load() {
      return current;
    },
    async save(entries) {
      current = { ...entries };
      saved.push({ ...entries });
    },
  };
}

function fetchReturning(map: Record<string, { url: string; status: number }>): LinkFetch {
  return async (url) => {
    const hit = map[url];
    if (hit === undefined) {
      throw new Error(`unexpected request to ${url}`);
    }
    return { ok: hit.status >= 200 && hit.status < 400, status: hit.status, url: hit.url };
  };
}

describe('the passthrough resolver (the default)', () => {
  it('hands every link back unchanged and makes no request', async () => {
    const resolver = createPassthroughLinkResolver();
    const result = await resolver.resolve(['https://juniorjobs.short.gy/abc']);

    expect(result.get('https://juniorjobs.short.gy/abc')).toEqual({
      originalUrl: 'https://juniorjobs.short.gy/abc',
      finalUrl: 'https://juniorjobs.short.gy/abc',
      resolved: false,
      status: null,
      error: null,
    });
  });
});

describe('the redirect resolver', () => {
  it('replaces a shortener with the destination the redirect chain ended at', async () => {
    const resolver = createRedirectLinkResolver({
      fetchImpl: fetchReturning({
        'https://juniorjobs.short.gy/abc': {
          url: 'https://boards.greenhouse.io/acme/jobs/4012345',
          status: 200,
        },
      }),
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
      concurrency: 2,
      timeoutMs: 1_000,
    });

    const result = await resolver.resolve(['https://juniorjobs.short.gy/abc']);

    expect(result.get('https://juniorjobs.short.gy/abc')).toMatchObject({
      originalUrl: 'https://juniorjobs.short.gy/abc',
      finalUrl: 'https://boards.greenhouse.io/acme/jobs/4012345',
      resolved: true,
      status: 200,
    });
  });

  it('KEEPS THE ORIGINAL LINK when the request fails, and never invents one', async () => {
    const logger = createRecordingLogger();
    const resolver = createRedirectLinkResolver({
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
      cache: memoryCache(),
      logger,
      now: () => NOW,
    });

    const result = await resolver.resolve(['https://juniorjobs.short.gy/dead']);
    const entry = result.get('https://juniorjobs.short.gy/dead');

    expect(entry).toMatchObject({
      finalUrl: 'https://juniorjobs.short.gy/dead',
      resolved: false,
      error: 'ECONNRESET',
    });
    expect(logger.messages.some((message) => message.level === 'warn')).toBe(true);
  });

  it('keeps the original link when the destination is not an http(s) address', async () => {
    const resolver = createRedirectLinkResolver({
      fetchImpl: fetchReturning({
        'https://juniorjobs.short.gy/app': { url: 'myapp://open/job/1', status: 200 },
      }),
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/app'])).get(
      'https://juniorjobs.short.gy/app',
    );

    expect(entry?.finalUrl).toBe('https://juniorjobs.short.gy/app');
    expect(entry?.resolved).toBe(false);
  });

  it('keeps the original link on an error status rather than pointing at a 404 page', async () => {
    const resolver = createRedirectLinkResolver({
      fetchImpl: fetchReturning({
        'https://juniorjobs.short.gy/gone': {
          url: 'https://boards.example.test/expired',
          status: 404,
        },
      }),
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/gone'])).get(
      'https://juniorjobs.short.gy/gone',
    );

    expect(entry?.finalUrl).toBe('https://juniorjobs.short.gy/gone');
    expect(entry?.resolved).toBe(false);
    expect(entry?.status).toBe(404);
  });

  it('asks for headers only - it never reads a page body', async () => {
    const seen: string[] = [];
    const resolver = createRedirectLinkResolver({
      fetchImpl: async (_url, init) => {
        seen.push(init.method);
        return { ok: true, status: 200, url: 'https://boards.example.test/jobs/1' };
      },
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    await resolver.resolve(['https://juniorjobs.short.gy/abc']);
    expect(seen).toEqual(['HEAD']);
  });

  it('retries once with GET when the server answers 405 to HEAD', async () => {
    const seen: string[] = [];
    const resolver = createRedirectLinkResolver({
      fetchImpl: async (_url, init) => {
        seen.push(init.method);
        return init.method === 'HEAD'
          ? { ok: false, status: 405, url: 'https://juniorjobs.short.gy/abc' }
          : { ok: true, status: 200, url: 'https://boards.example.test/jobs/1' };
      },
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/abc'])).get(
      'https://juniorjobs.short.gy/abc',
    );

    expect(seen).toEqual(['HEAD', 'GET']);
    expect(entry?.finalUrl).toBe('https://boards.example.test/jobs/1');
  });

  it('retries once with GET when HEAD dies at the socket', async () => {
    // Real behaviour, observed against real career sites: some servers reset the
    // connection on HEAD and answer GET perfectly. Without this the pipeline
    // would keep the shortener for a link it could have resolved.
    const seen: string[] = [];
    const resolver = createRedirectLinkResolver({
      fetchImpl: async (_url, init) => {
        seen.push(init.method);
        if (init.method === 'HEAD') {
          throw new Error('Recv failure: Connection was reset');
        }
        return { ok: true, status: 200, url: 'https://boards.example.test/jobs/2' };
      },
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/abc'])).get(
      'https://juniorjobs.short.gy/abc',
    );

    expect(seen).toEqual(['HEAD', 'GET']);
    expect(entry?.resolved).toBe(true);
  });

  it('gives up after the GET retry rather than hammering the server', async () => {
    const seen: string[] = [];
    const resolver = createRedirectLinkResolver({
      fetchImpl: async (_url, init) => {
        seen.push(init.method);
        throw new Error('ECONNRESET');
      },
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/abc'])).get(
      'https://juniorjobs.short.gy/abc',
    );

    expect(seen).toEqual(['HEAD', 'GET']);
    expect(entry?.finalUrl).toBe('https://juniorjobs.short.gy/abc');
    expect(entry?.resolved).toBe(false);
  });

  it('requests each unique link exactly once, however many entries share it', async () => {
    const impl = vi.fn<LinkFetch>(async () => ({
      ok: true,
      status: 200,
      url: 'https://boards.example.test/jobs/1',
    }));

    const resolver = createRedirectLinkResolver({
      fetchImpl: impl,
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
    });

    await resolver.resolve([
      'https://juniorjobs.short.gy/same',
      'https://juniorjobs.short.gy/same',
      'https://juniorjobs.short.gy/same',
    ]);

    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('never exceeds the configured concurrency', async () => {
    let inFlight = 0;
    let peak = 0;

    const resolver = createRedirectLinkResolver({
      fetchImpl: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((done) => setTimeout(done, 1));
        inFlight -= 1;
        return { ok: true, status: 200, url: 'https://boards.example.test/jobs/1' };
      },
      cache: memoryCache(),
      logger: silentLogger,
      now: () => NOW,
      concurrency: 2,
    });

    await resolver.resolve(
      Array.from({ length: 10 }, (_, index) => `https://juniorjobs.short.gy/${index}`),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('reuses a cached resolution instead of hitting the same shortener twice', async () => {
    const impl = vi.fn<LinkFetch>(async () => ({
      ok: true,
      status: 200,
      url: 'https://boards.example.test/jobs/1',
    }));

    const resolver = createRedirectLinkResolver({
      fetchImpl: impl,
      cache: memoryCache({
        'https://juniorjobs.short.gy/cached': {
          finalUrl: 'https://boards.example.test/jobs/999',
          status: 200,
          resolved: true,
          resolvedAt: '2026-09-07T10:00:00.000Z',
        },
      }),
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/cached'])).get(
      'https://juniorjobs.short.gy/cached',
    );

    expect(impl).not.toHaveBeenCalled();
    expect(entry?.finalUrl).toBe('https://boards.example.test/jobs/999');
  });

  it('persists new resolutions so the next run does not re-hit the network', async () => {
    const cache = memoryCache();
    const resolver = createRedirectLinkResolver({
      fetchImpl: fetchReturning({
        'https://juniorjobs.short.gy/new': { url: 'https://boards.example.test/jobs/7', status: 200 },
      }),
      cache,
      logger: silentLogger,
      now: () => NOW,
    });

    await resolver.resolve(['https://juniorjobs.short.gy/new']);

    expect(cache.saved).toHaveLength(1);
    expect(cache.saved[0]).toMatchObject({
      'https://juniorjobs.short.gy/new': {
        finalUrl: 'https://boards.example.test/jobs/7',
        resolved: true,
      },
    });
  });

  it('does not cache a failure, so a transient outage is retried next run', async () => {
    const cache = memoryCache();
    const resolver = createRedirectLinkResolver({
      fetchImpl: async () => {
        throw new Error('timeout');
      },
      cache,
      logger: silentLogger,
      now: () => NOW,
    });

    await resolver.resolve(['https://juniorjobs.short.gy/flaky']);

    expect(cache.saved.at(-1) ?? {}).toEqual({});
  });

  it('makes a SECOND RUN free: what it learned once it never asks again', async () => {
    /*
     * Resolution is the default now, so this is no longer a nicety - it is what
     * stops the default behaviour from hitting somebody's shortener 212 times
     * every single morning. Two separate resolver instances sharing one cache
     * file, which is what two `npm start` runs actually are.
     */
    const cache = memoryCache();
    const links = ['https://juniorjobs.short.gy/a', 'https://juniorjobs.short.gy/b'];

    const impl = vi.fn<LinkFetch>(async (url) => ({
      ok: true,
      status: 200,
      url: `https://boards.example.test/jobs/${url.slice(-1)}`,
    }));

    const build = () =>
      createRedirectLinkResolver({
        fetchImpl: impl,
        cache,
        logger: silentLogger,
        now: () => NOW,
      });

    await build().resolve(links);
    expect(impl).toHaveBeenCalledTimes(2);

    impl.mockClear();
    const second = await build().resolve(links);

    expect(impl).not.toHaveBeenCalled();
    expect(second.get('https://juniorjobs.short.gy/a')).toMatchObject({
      finalUrl: 'https://boards.example.test/jobs/a',
      resolved: true,
    });
  });

  it('survives a cache it cannot read', async () => {
    const resolver = createRedirectLinkResolver({
      fetchImpl: fetchReturning({
        'https://juniorjobs.short.gy/a': { url: 'https://boards.example.test/jobs/1', status: 200 },
      }),
      cache: {
        load: async () => {
          throw new Error('EACCES');
        },
        save: async () => undefined,
      },
      logger: silentLogger,
      now: () => NOW,
    });

    const entry = (await resolver.resolve(['https://juniorjobs.short.gy/a'])).get(
      'https://juniorjobs.short.gy/a',
    );
    expect(entry?.finalUrl).toBe('https://boards.example.test/jobs/1');
  });
});
