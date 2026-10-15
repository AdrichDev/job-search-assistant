import { z } from 'zod';
import { BOARD_USER_AGENT, mapWithConcurrency } from '../boards/board-http.js';
import type { Logger } from '../../ports/logger.js';

/**
 * TRACKING-LINK RESOLUTION - the one network call this adapter may make, and
 * the fence around it.
 *
 * Newsletters do not link to job pages, they link to themselves: every entry in
 * the real sample points at `juniorjobs.short.gy/<token>`, which 301s to the
 * employer's actual posting. Following that redirect is ENRICHMENT, not
 * scraping - it asks the shortener "where does this go" and reads the answer
 * off the response, exactly like clicking the link would.
 *
 * The line between that and scraping is drawn here, mechanically:
 *
 *   - ONE request per UNIQUE link. Duplicate entries share a resolution.
 *   - `HEAD`. No body is requested, and no body is ever parsed. The GET
 *     fallback exists only for servers that answer 405 to HEAD, and it too
 *     reads nothing but the final URL.
 *   - A hard timeout and a bounded number of requests in flight.
 *   - Results cached to disk, so a re-run costs zero requests.
 *   - OPT-IN. The default resolver below makes no requests at all.
 *
 * And the rule that outranks all of them:
 *
 *   A FAILED RESOLUTION KEEPS THE ORIGINAL LINK.
 *
 * Never a guess, never a search URL, never an address assembled from the title.
 * The shortener link works in a browser; a fabricated "real" URL does not, and
 * this project has already paid for that lesson once.
 */

/** What was asked for, what came back, and whether anything was learned. */
export interface LinkResolution {
  /** The address exactly as the newsletter wrote it. */
  readonly originalUrl: string;
  /** What the job will actually link to: the destination, or the original. */
  readonly finalUrl: string;
  /** True only when a destination was successfully determined. */
  readonly resolved: boolean;
  readonly status: number | null;
  readonly error: string | null;
}

export interface LinkResolver {
  /** Maps every input link to a resolution. Every input gets an entry. */
  resolve(urls: readonly string[]): Promise<ReadonlyMap<string, LinkResolution>>;
}

/** Minimal `fetch` surface, so tests need no `Response` polyfill. */
export interface LinkFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  /** The address the redirect chain ended at. */
  readonly url: string;
}

export interface LinkFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
}

export type LinkFetch = (url: string, init: LinkFetchInit) => Promise<LinkFetchResponse>;

/**
 * The on-disk memory of what resolved to what.
 *
 * `load` returns `unknown` on purpose: this is a JSON file a human can open,
 * edit and corrupt, so it is validated rather than trusted.
 */
export interface LinkResolutionCache {
  load(): Promise<unknown>;
  save(entries: Readonly<Record<string, CachedResolution>>): Promise<void>;
}

export interface CachedResolution {
  readonly finalUrl: string;
  readonly status: number | null;
  readonly resolved: boolean;
  readonly resolvedAt: string;
}

const cachedResolutionSchema = z.object({
  finalUrl: z.string(),
  status: z.number().nullable(),
  resolved: z.boolean(),
  resolvedAt: z.string(),
});

const cacheFileSchema = z.record(cachedResolutionSchema);

export const DEFAULT_LINK_CONCURRENCY = 4;
export const DEFAULT_LINK_TIMEOUT_MS = 10_000;

/** Status codes that mean "this server dislikes HEAD", not "this link is dead". */
const HEAD_UNSUPPORTED = new Set([405, 501]);

const RESOLVABLE_PROTOCOLS = new Set(['http:', 'https:']);

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function keepOriginal(
  originalUrl: string,
  status: number | null,
  error: string | null,
): LinkResolution {
  return { originalUrl, finalUrl: originalUrl, resolved: false, status, error };
}

/**
 * The DEFAULT: hand every link back untouched.
 *
 * Resolution is opt-in because it is the only thing in this adapter that leaves
 * the machine, and because the pipeline is perfectly usable without it - a
 * `short.gy` link opens the posting in a browser just fine.
 */
export function createPassthroughLinkResolver(): LinkResolver {
  return {
    async resolve(urls: readonly string[]): Promise<ReadonlyMap<string, LinkResolution>> {
      const resolutions = new Map<string, LinkResolution>();
      for (const url of urls) {
        resolutions.set(url, {
          originalUrl: url,
          finalUrl: url,
          resolved: false,
          status: null,
          error: null,
        });
      }
      return resolutions;
    },
  };
}

export interface RedirectLinkResolverOptions {
  readonly cache: LinkResolutionCache;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly fetchImpl?: LinkFetch;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
}

function defaultFetch(): LinkFetch {
  return async (url, init) => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      signal: init.signal,
      redirect: 'follow',
    });
    /*
     * The body is discarded without being read. That is the difference between
     * "where does this link go" and "what does that page say", and it is the
     * difference this whole module exists to keep.
     */
    await response.body?.cancel().catch(() => undefined);
    return { ok: response.ok, status: response.status, url: response.url || url };
  };
}

export function createRedirectLinkResolver(options: RedirectLinkResolverOptions): LinkResolver {
  const doFetch = options.fetchImpl ?? defaultFetch();
  const concurrency = options.concurrency ?? DEFAULT_LINK_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LINK_TIMEOUT_MS;

  async function request(url: string, method: string): Promise<LinkFetchResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await doFetch(url, {
        method,
        headers: { 'User-Agent': BOARD_USER_AGENT, Accept: '*/*' },
        signal: controller.signal,
      });
    } catch (cause: unknown) {
      throw timedOut ? new Error(`request timed out after ${timeoutMs}ms`) : cause;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * HEAD first, GET once as a fallback, then stop.
   *
   * Two ways a server refuses a HEAD, both observed against real career sites:
   * it answers 405/501, or it resets the connection outright. Both are
   * statements about the METHOD, not about the link, so retrying once with GET
   * is the difference between resolving a posting and needlessly keeping a
   * shortener.
   *
   * The GET still reads no page: `defaultFetch` cancels the body without
   * touching it. And it is ONE retry - a resolver that keeps trying is a
   * resolver that has become a crawler.
   */
  async function fetchDestination(url: string): Promise<LinkFetchResponse> {
    try {
      const head = await request(url, 'HEAD');
      return HEAD_UNSUPPORTED.has(head.status) ? await request(url, 'GET') : head;
    } catch {
      return await request(url, 'GET');
    }
  }

  async function resolveOne(url: string): Promise<LinkResolution> {
    let response: LinkFetchResponse;
    try {
      response = await fetchDestination(url);
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      options.logger.warn(`[newsletter] could not resolve ${url} (${message}); kept the original link`);
      return keepOriginal(url, null, message);
    }

    if (!response.ok) {
      // A 404 destination is worse than an unresolved shortener: the shortener
      // at least still redirects. Keep what the newsletter gave us.
      options.logger.warn(
        `[newsletter] ${url} answered HTTP ${response.status}; kept the original link`,
      );
      return keepOriginal(url, response.status, `HTTP ${response.status}`);
    }

    let destination: URL;
    try {
      destination = new URL(response.url);
    } catch {
      return keepOriginal(url, response.status, `"${response.url}" is not an absolute URL`);
    }

    if (!RESOLVABLE_PROTOCOLS.has(destination.protocol)) {
      // Some shorteners bounce to an app deep link. A browser cannot open it as
      // a job posting, so the original stays.
      options.logger.warn(
        `[newsletter] ${url} resolved to a non-web address (${destination.protocol}); kept the original link`,
      );
      return keepOriginal(url, response.status, `unusable protocol "${destination.protocol}"`);
    }

    return {
      originalUrl: url,
      finalUrl: response.url,
      resolved: true,
      status: response.status,
      error: null,
    };
  }

  async function loadCache(): Promise<Record<string, CachedResolution>> {
    try {
      const parsed = cacheFileSchema.safeParse(await options.cache.load());
      // A corrupt cache costs one run of extra requests, which is strictly
      // better than refusing to run or trusting a file we cannot read.
      return parsed.success ? { ...parsed.data } : {};
    } catch (cause: unknown) {
      options.logger.warn(
        `[newsletter] link cache unavailable (${errorMessage(cause)}); resolving from scratch`,
      );
      return {};
    }
  }

  return {
    async resolve(urls: readonly string[]): Promise<ReadonlyMap<string, LinkResolution>> {
      const resolutions = new Map<string, LinkResolution>();
      if (urls.length === 0) {
        return resolutions;
      }

      const cached = await loadCache();
      // One request per UNIQUE link. The real digest repeats several of them
      // across countries, and asking the shortener three times for the same
      // token is traffic nobody needs.
      const unique = [...new Set(urls)];
      const pending: string[] = [];

      for (const url of unique) {
        const hit = cached[url];
        if (hit !== undefined && hit.resolved) {
          resolutions.set(url, {
            originalUrl: url,
            finalUrl: hit.finalUrl,
            resolved: true,
            status: hit.status,
            error: null,
          });
          continue;
        }
        pending.push(url);
      }

      const fresh = await mapWithConcurrency(pending, concurrency, resolveOne);

      const resolvedAt = options.now().toISOString();
      let learnedSomething = false;

      for (const resolution of fresh) {
        resolutions.set(resolution.originalUrl, resolution);
        /*
         * Only successes are cached. A timeout is a fact about a bad minute on
         * someone's wifi, not about the link - persisting it would freeze a
         * working posting behind a permanent shortener for no reason.
         */
        if (resolution.resolved) {
          cached[resolution.originalUrl] = {
            finalUrl: resolution.finalUrl,
            status: resolution.status,
            resolved: true,
            resolvedAt,
          };
          learnedSomething = true;
        }
      }

      if (learnedSomething) {
        try {
          await options.cache.save(cached);
        } catch (cause: unknown) {
          options.logger.warn(
            `[newsletter] could not write the link cache (${errorMessage(cause)}); ` +
              'the next run will resolve these links again',
          );
        }
      }

      return resolutions;
    },
  };
}
