import type { LivenessRecord } from '../domain/link-liveness.js';

/**
 * Driven port: "is this address still serving something?"
 *
 * A port rather than a direct call into the adapter, for the usual reason and
 * one specific one. The usual reason: `buildJobQueue` must stay testable
 * without a network. The specific one: this is the only dependency in the
 * pipeline that can DELETE a posting, so the seam where a test can hand it a
 * timeout, a 403 or a total outage has to be first-class rather than a `vi.mock`
 * of `globalThis.fetch`.
 *
 * The contract deliberately does NOT promise an entry for every input. A URL
 * that was never checked - because checking is off, or because the checker gave
 * up - is simply absent from the map, and an absent record means `unverified`,
 * which means kept. Returning a fabricated "unknown" entry per URL would work
 * too, but absence makes the safe reading the DEFAULT rather than a value a
 * caller has to remember to handle.
 */
export interface LinkChecker {
  /**
   * Checks the given addresses. Never throws for an individual failure: a URL
   * that could not be checked comes back as `unverified` or not at all.
   */
  check(urls: readonly string[]): Promise<ReadonlyMap<string, LivenessRecord>>;

  /**
   * How much traffic this actually cost, drained by the caller for the report.
   *
   * Same `take*` convention as `JobSource.takeDegradedTargets` and
   * `NewsletterJobSource.takeLinkProvenance`: the pipeline collects the number,
   * the CLI prints it, and nobody has to thread a counter through the use case.
   *
   * Optional so a test double can be three lines.
   */
  takeStats?(): LinkCheckerStats;
}

/** What one run of the checker spent. */
export interface LinkCheckerStats {
  /** Requests actually put on the wire. The number that has to stay small. */
  readonly requests: number;
  /** Answers served from the TTL cache. The number that should be large on a re-run. */
  readonly fromCache: number;
}
