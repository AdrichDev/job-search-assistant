/**
 * The politeness layer for the free, unauthenticated board APIs.
 *
 * None of these endpoints charges anything, rate-limits visibly, or asks for a
 * key. That is exactly why this file exists: the only thing standing between
 * this pipeline and a company's ATS is our own restraint. Three rules, all
 * enforced here rather than trusted to each adapter:
 *
 *   1. a bounded number of requests in flight at a time
 *   2. a hard timeout, so one hanging board cannot stall the whole run
 *   3. a User-Agent that says who we are, so an operator seeing this traffic
 *      can identify it instead of guessing
 */

/** Minimal `fetch` surface, so tests need no `Response` polyfill. */
export interface BoardHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  /**
   * Optional because almost every endpoint here is JSON.
   *
   * The exception is Manfred's `sitemap-offers.xml`, which is that source's
   * only authoritative record of a posting's public address. It is a sitemap -
   * a machine-readable index the site advertises in `robots.txt` for exactly
   * this kind of consumption - not an HTML page being scraped for content.
   */
  text?(): Promise<string>;
}

export interface BoardFetchInit {
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
}

export type BoardFetch = (url: string, init: BoardFetchInit) => Promise<BoardHttpResponse>;

/**
 * Honest, contactable identification.
 *
 * A blank or browser-impersonating User-Agent on someone else's free endpoint
 * is how a personal job search turns into abuse.
 */
export const BOARD_USER_AGENT =
  'job-queue-pipeline/0.3 (+personal job search; contact: github.com/AdrichDev)';

export const DEFAULT_BOARD_TIMEOUT_MS = 15_000;

/** Small on purpose: these are free endpoints, not a service we pay for. */
export const DEFAULT_BOARD_CONCURRENCY = 4;

export interface FetchBoardJsonOptions {
  readonly fetchImpl?: BoardFetch;
  readonly timeoutMs?: number;
}

function defaultFetch(): BoardFetch {
  return (url, init) => fetch(url, init).then((response) => response as BoardHttpResponse);
}

/**
 * One board request: identified, time-boxed, and decoded by `read`.
 *
 * Every failure mode is converted into a readable `Error` rather than left as
 * whatever the platform threw, because these messages end up verbatim in the
 * user-facing source report.
 */
async function fetchBoard<T>(
  url: string,
  accept: string,
  read: (response: BoardHttpResponse) => Promise<T>,
  options: FetchBoardJsonOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BOARD_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? defaultFetch();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await doFetch(url, {
      headers: {
        'User-Agent': BOARD_USER_AGENT,
        Accept: accept,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await read(response);
  } catch (cause: unknown) {
    if (timedOut) {
      throw new Error(`request timed out after ${timeoutMs}ms`);
    }
    throw cause instanceof Error ? cause : new Error(String(cause));
  } finally {
    // Without this an aborted-but-still-pending timer keeps the process alive
    // long after the CLI has printed its table.
    clearTimeout(timer);
  }
}

export async function fetchBoardJson(
  url: string,
  options: FetchBoardJsonOptions = {},
): Promise<unknown> {
  return fetchBoard(
    url,
    'application/json',
    async (response) => {
      try {
        return await response.json();
      } catch {
        // A board answering 200 with an HTML error page is a real failure mode,
        // and "Unexpected token <" tells the reader nothing about what happened.
        throw new Error('the endpoint did not return JSON');
      }
    },
    options,
  );
}

/**
 * The same politeness, for the one endpoint that is not JSON.
 *
 * See `BoardHttpResponse.text` for why a text fetch exists at all. A response
 * that cannot produce text is reported as such rather than coerced, so a test
 * double that forgets to implement it fails loudly instead of yielding
 * `"undefined"` and a source with no URLs.
 */
export async function fetchBoardText(
  url: string,
  options: FetchBoardJsonOptions = {},
): Promise<string> {
  return fetchBoard(
    url,
    'application/xml,text/xml;q=0.9,*/*;q=0.8',
    async (response) => {
      if (typeof response.text !== 'function') {
        throw new Error('the endpoint did not return a readable text body');
      }
      return response.text();
    },
    options,
  );
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input
 * order in the result.
 *
 * Order matters: the queue's dedupe keeps the FIRST-SEEN posting as the
 * survivor, so a result order that changed with network timing would make the
 * morning list shuffle itself for no reason.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`concurrency limit must be a positive integer, received ${limit}`);
  }
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) {
        return;
      }
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}
