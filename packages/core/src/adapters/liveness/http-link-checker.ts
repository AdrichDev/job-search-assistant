import { z } from 'zod';
import { BOARD_USER_AGENT, mapWithConcurrency } from '../boards/board-http.js';
import { judgeLiveness, type LivenessRecord, type LivenessVerdict } from '../../domain/link-liveness.js';
import type { LinkChecker, LinkCheckerStats } from '../../ports/link-checker.js';
import type { Logger } from '../../ports/logger.js';

/**
 * ASKING WHETHER A POSTING IS STILL THERE - and the fence that keeps that from
 * becoming crawling.
 *
 * This is the only new outbound traffic in the pipeline, and it is aimed at
 * every source rather than just the newsletter: a Greenhouse posting closes
 * exactly as often as a shortened one, it just does so without a redirect to
 * make it obvious. So the same restraint the board adapters and the link
 * resolver already observe applies here, enforced mechanically:
 *
 *   - `HEAD`. No body is requested and no body is ever read. The single GET
 *     retry exists only for servers that refuse HEAD, and it cancels the body
 *     without touching it. That is the whole difference between "does this
 *     address serve something" and "what does that page say", and this project
 *     is only allowed to ask the first question.
 *   - ONE request per unique address, however many postings share it.
 *   - A bounded number in flight, and a hard per-request timeout.
 *   - A disk cache with a TTL, so a run five minutes after another spends
 *     almost nothing.
 *   - ONE retry, ever. A checker that keeps trying has become a crawler.
 *
 * ## What may be remembered, and what may not
 *
 * The cache is where a well-meaning checker does its real damage, so the rule
 * is narrow:
 *
 *   alive / gone     remembered for `ttlMs`. These are answers about the
 *                    posting.
 *   4xx-and-5xx-that-are-not-gone   remembered for the much shorter
 *                    `unverifiedTtlMs`. A 403 is not an answer about the
 *                    vacancy - it is an answer about US - but re-asking a
 *                    server that just told us to go away, on every single run,
 *                    is its own kind of rudeness. So it is remembered briefly,
 *                    and never long enough to matter.
 *   network failures NEVER WRITTEN. A timeout, a reset, a DNS failure or a TLS
 *                    error is a fact about one bad minute. Persisting it as a
 *                    verdict is how a flaky moment turns into a permanent mark
 *                    against a healthy posting - and, in a checker one edit
 *                    away from this one, into a deletion.
 *
 * The same asymmetry as `domain/link-liveness.ts`, applied to memory instead of
 * to judgement.
 */

/** Minimal `fetch` surface, so tests need no `Response` polyfill. */
export interface LinkCheckResponse {
  readonly status: number;
  readonly url: string;
}

export interface LinkCheckInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
}

export type LinkCheckFetch = (url: string, init: LinkCheckInit) => Promise<LinkCheckResponse>;

/**
 * The on-disk memory of what was reachable when.
 *
 * `load` returns `unknown` for the same reason the link cache does: this is a
 * JSON file a human can open, edit and corrupt, so it is validated rather than
 * trusted.
 */
export interface LivenessCache {
  load(): Promise<unknown>;
  save(entries: Readonly<Record<string, CachedLiveness>>): Promise<void>;
}

export interface CachedLiveness {
  readonly verdict: LivenessVerdict;
  readonly status: number | null;
  readonly checkedAt: string;
}

const cachedLivenessSchema = z.object({
  verdict: z.enum(['alive', 'gone', 'unverified']),
  status: z.number().nullable(),
  checkedAt: z.string(),
});

const cacheFileSchema = z.record(cachedLivenessSchema);

/**
 * How long a settled verdict is trusted.
 *
 * Twelve hours, which is chosen against a daily habit rather than pulled from
 * the air: the candidate runs this in the morning, and re-running an hour later
 * to see a new newsletter must not re-ask two hundred careers pages. A posting
 * that closes at noon is caught the next morning, and the cost of that lag is
 * one wasted click - the cheap side of the asymmetry.
 */
export const DEFAULT_LIVENESS_TTL_MS = 12 * 60 * 60 * 1_000;

/**
 * How long a NON-verdict is remembered. Deliberately much shorter.
 *
 * Long enough that a burst of runs does not hammer a server which already
 * answered 403; short enough that a posting behind a temporary block is
 * re-examined the same day rather than carrying an "unverified" badge it no
 * longer deserves.
 */
export const DEFAULT_LIVENESS_UNVERIFIED_TTL_MS = 60 * 60 * 1_000;

export const DEFAULT_LIVENESS_CONCURRENCY = 4;
export const DEFAULT_LIVENESS_TIMEOUT_MS = 10_000;

/** Statuses that mean "this server dislikes HEAD", not "this link is dead". */
const HEAD_UNSUPPORTED = new Set([405, 501]);

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/*
 * THERE IS NO PASSTHROUGH CHECKER HERE, and its absence is deliberate.
 *
 * The newsletter resolver next door has one, because "hand every link back
 * unchanged" is a real behaviour that produces real output. "Check nothing" is
 * not: it produces no records, which is indistinguishable from a checker whose
 * every request came back empty.
 *
 * A passthrough was written here first, and it shipped a bug within the hour: a
 * `--no-check-links` run reported "Link liveness: 0 checked, 0 reachable",
 * because `buildJobQueue` had two representations of "off" - an absent checker
 * and a present one that answers nothing - and could only tell one of them from
 * a failure.
 *
 * So "off" has exactly one spelling: no checker at all. `BuildJobQueueDeps
 * .linkChecker` is optional precisely so that spelling exists, and the
 * composition root uses it.
 */

export interface HttpLinkCheckerOptions {
  readonly cache: LivenessCache;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly fetchImpl?: LinkCheckFetch;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly ttlMs?: number;
  readonly unverifiedTtlMs?: number;
}

function defaultFetch(): LinkCheckFetch {
  return async (url, init) => {
    const response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      signal: init.signal,
      /*
       * FOLLOW, because the question is the one a candidate's browser asks:
       * "if I click this, do I land on a posting?"
       *
       * It matters more than it looks. `juniorjobs.short.gy/hh6WWK` answers 302
       * on its own - a perfectly healthy-looking shortener - and following it
       * lands on `amazon.jobs/en/jobs/10431349/...` which answers 404. Checking
       * without following would have called that posting alive and left a dead
       * apply button in the list, which is the exact defect this change exists
       * to close.
       */
      redirect: 'follow',
    });
    // Discarded without being read. This is a liveness check, not a scraper.
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, url: response.url || url };
  };
}

export function createHttpLinkChecker(options: HttpLinkCheckerOptions): LinkChecker {
  const doFetch = options.fetchImpl ?? defaultFetch();
  const concurrency = options.concurrency ?? DEFAULT_LIVENESS_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
  const ttlMs = options.ttlMs ?? DEFAULT_LIVENESS_TTL_MS;
  const unverifiedTtlMs = options.unverifiedTtlMs ?? DEFAULT_LIVENESS_UNVERIFIED_TTL_MS;

  let requests = 0;
  let fromCache = 0;

  async function request(url: string, method: string): Promise<LinkCheckResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    requests += 1;

    try {
      return await doFetch(url, {
        method,
        headers: { 'User-Agent': BOARD_USER_AGENT, Accept: '*/*' },
        signal: controller.signal,
      });
    } catch (cause: unknown) {
      throw timedOut ? new Error(`request timed out after ${timeoutMs}ms`) : cause;
    } finally {
      // Without this an aborted-but-pending timer keeps the process alive long
      // after the CLI has printed its table.
      clearTimeout(timer);
    }
  }

  /**
   * HEAD first, GET once, then stop.
   *
   * Two ways a server refuses a HEAD, both observed against real career sites:
   * it answers 405/501, or it resets the connection outright. Both are
   * statements about the METHOD rather than about the posting, so one retry is
   * the difference between a real verdict and a spurious "unverified" badge.
   *
   * Exactly one retry. The second failure is accepted as the answer.
   */
  async function probe(url: string): Promise<LivenessRecord> {
    const checkedAt = options.now().toISOString();
    const answered = (status: number): LivenessRecord => ({
      verdict: judgeLiveness({ status, error: null }),
      status,
      checkedAt,
      error: null,
    });

    try {
      const head = await request(url, 'HEAD');
      if (!HEAD_UNSUPPORTED.has(head.status)) {
        return answered(head.status);
      }
      // Falls through to the ONE retry below. Not a nested request, precisely
      // so that a failing retry cannot trigger a third attempt.
    } catch {
      // Also falls through. A refused HEAD and a rejected HEAD are the same
      // fact - "not with that method" - and earn the same single retry.
    }

    try {
      return answered((await request(url, 'GET')).status);
    } catch (cause: unknown) {
      /*
       * Both attempts failed at the transport layer. This is the branch that
       * keeps the two live CaixaBank Tech roles in the list: their destination
       * answers Node's fetch with ECONNRESET, to HEAD and GET alike, while
       * serving browsers and curl normally.
       *
       * It reports `status: null`, which `judgeLiveness` reads as `unverified`,
       * which is KEPT. There is no path from here to a deletion, by
       * construction - and that is deliberate, because "the server hung up on
       * us" is the single most tempting thing to mistake for "the job is gone".
       */
      return { verdict: 'unverified', status: null, checkedAt, error: errorMessage(cause) };
    }
  }

  function ttlFor(verdict: LivenessVerdict): number {
    return verdict === 'unverified' ? unverifiedTtlMs : ttlMs;
  }

  function isFresh(entry: CachedLiveness, now: Date): boolean {
    const checkedAt = Date.parse(entry.checkedAt);
    if (!Number.isFinite(checkedAt)) {
      // An unparseable timestamp is not a fresh one. Re-check rather than
      // trusting a value we cannot date.
      return false;
    }
    return now.getTime() - checkedAt < ttlFor(entry.verdict);
  }

  async function loadCache(): Promise<Record<string, CachedLiveness>> {
    try {
      const parsed = cacheFileSchema.safeParse(await options.cache.load());
      // A corrupt cache costs one run of extra requests, which is strictly
      // better than refusing to run or trusting a file we cannot read.
      return parsed.success ? { ...parsed.data } : {};
    } catch (cause: unknown) {
      options.logger.warn(
        `[liveness] cache unavailable (${errorMessage(cause)}); checking from scratch`,
      );
      return {};
    }
  }

  return {
    takeStats(): LinkCheckerStats {
      const stats = { requests, fromCache };
      requests = 0;
      fromCache = 0;
      return stats;
    },

    async check(urls: readonly string[]): Promise<ReadonlyMap<string, LivenessRecord>> {
      const records = new Map<string, LivenessRecord>();
      if (urls.length === 0) {
        return records;
      }

      const now = options.now();
      const cached = await loadCache();
      const unique = [...new Set(urls)];
      const pending: string[] = [];

      for (const url of unique) {
        const hit = cached[url];
        if (hit !== undefined && isFresh(hit, now)) {
          fromCache += 1;
          records.set(url, {
            verdict: hit.verdict,
            status: hit.status,
            checkedAt: hit.checkedAt,
            error: null,
          });
          continue;
        }
        pending.push(url);
      }

      const fresh = await mapWithConcurrency(pending, concurrency, probe);

      let learnedSomething = false;
      for (const [index, record] of fresh.entries()) {
        const url = pending[index];
        if (url === undefined) {
          continue;
        }
        records.set(url, record);

        /*
         * ONLY completed requests are written. `error !== null` means the
         * transport failed, and a transport failure is never a verdict.
         */
        if (record.error === null) {
          cached[url] = {
            verdict: record.verdict,
            status: record.status,
            checkedAt: record.checkedAt,
          };
          learnedSomething = true;
        }
      }

      if (learnedSomething) {
        try {
          await options.cache.save(cached);
        } catch (cause: unknown) {
          options.logger.warn(
            `[liveness] could not write the liveness cache (${errorMessage(cause)}); ` +
              'the next run will check these links again',
          );
        }
      }

      return records;
    },
  };
}
