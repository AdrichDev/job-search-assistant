import type { ApplicationOutcome } from '../domain/application.js';
import type { CvCategorySuggestion } from '../domain/cv-category.js';
import type { CvVariant, JobSourceRef } from '../domain/job.js';
import type { LivenessRecord } from '../domain/link-liveness.js';
import type { JobRequirements } from '../domain/requirements.js';
import type { ScoreBreakdownItem } from '../domain/scoring/types.js';
import type { SourceTargetFailure } from './job-source.js';

export type { SourceTargetFailure };

/**
 * The output contract of the pipeline.
 *
 * It lives in `ports`, not in `app`, so the dependency arrow stays
 * adapters -> app -> ports -> domain. Fully serializable: no `Date`, no class
 * instances, so any writer (file, database, HTTP) can consume it as-is.
 */

/** One (source, query) attempt. Failures are reported here, never thrown. */
export interface SourceReport {
  readonly sourceId: string;
  readonly query: string;
  readonly status: 'ok' | 'failed';
  readonly fetched: number;
  readonly error?: string;
  /**
   * Sub-fetches that died while the source as a whole still worked - in
   * practice, individual company boards that 404'd.
   *
   * Kept OFF `status` on purpose. A provider spanning fourteen boards loses one
   * on an ordinary day; if that counted as a failed source query, the queue
   * would print "Degraded run" every single morning and the candidate would
   * learn to skip the line that occasionally matters. Absent when nothing was
   * degraded, so the persisted JSON stays clean.
   */
  readonly degradedTargets?: readonly SourceTargetFailure[];
}

/**
 * Where a vacancy stands. `not_applied` is a first-class state rather than an
 * absent field, so the UI never has to guess what `undefined` meant.
 */
export type QueueApplicationStatus = 'not_applied' | ApplicationOutcome;

export interface QueueEntry {
  /**
   * 1-based position in the list AS SHOWN, which is newest first.
   *
   * A position, not a verdict. It used to be a score ranking; it is now just
   * "how far down the page this sits", which is why the UI no longer prints it.
   */
  readonly rank: number;
  readonly id: string;
  /**
   * 0..100 quality estimate. Still computed and still persisted, because the
   * application-outcome analysis needs it to correlate score against reply
   * rate - but it no longer orders this list and it never excludes anything.
   */
  readonly score: number;
  readonly cvVariant: CvVariant;
  /** Structured signals for the UI chips. */
  readonly requirements: JobRequirements;
  /**
   * Which KIND of CV the offer's own wording supports, with the evidence.
   *
   * OPTIONAL on purpose: a queue written before this existed carries no
   * analysis, and the UI renders nothing for it rather than pretending it was
   * analysed. A newly analysed offer with no evidence still carries a General
   * suggestion, which is a statement, not an absence. It is a category
   * recommendation only - never a registry model, a path or a selection - and
   * it is independent of the legacy `cvVariant` above.
   */
  readonly cvCategorySuggestion?: CvCategorySuggestion;
  readonly applicationStatus: QueueApplicationStatus;
  /** ISO timestamps, or null when the job was never applied to. */
  readonly appliedAt: string | null;
  readonly outcomeUpdatedAt: string | null;
  readonly notes: string | null;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly url: string;
  readonly postedAt: string;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly contractType: string | null;
  readonly sources: readonly JobSourceRef[];
  readonly breakdown: readonly ScoreBreakdownItem[];
  /**
   * Whether this address was still serving a posting when it was last checked.
   *
   * `null` means NOT CHECKED - because `--no-check-links` was passed, because
   * the checker could not reach the network, or because this queue was written
   * by a build that predates liveness checking. It never means "dead": the only
   * verdict that removes a posting is `gone`, and a posting carrying `gone`
   * never reaches this list.
   *
   * It is here rather than only in the checker's cache file because that is
   * exactly where the previous version of this information died. The resolver
   * has known these statuses for weeks - it logged them, kept the original
   * link and moved on - and not one of them ever reached the queue, the CLI or
   * the UI. A fact the pipeline learns and then discards is a fact the product
   * does not have.
   */
  readonly liveness: LivenessRecord | null;
}

/**
 * Why a posting is not in the list.
 *
 * The first two are the hard filters, which judge the CONTENT of a posting.
 * `dead_link` is different in kind and worth reading as such: the posting
 * qualified on every count and was removed because the address it lives at
 * answered 404 or 410. Nothing about the candidate or the vacancy failed - the
 * vacancy simply is not there any more.
 */
export type ExclusionFilter =
  | 'software_relevance'
  /**
   * LEGACY. Written by queues produced before the unified hard eligibility
   * filter split this verdict into the three stable codes below. Still readable
   * and still counted as "not junior", never produced by a new run.
   */
  | 'junior_eligibility'
  /** Unified hard filter: explicit location outside Madrid/nearby/remote-from-Spain. */
  | 'location_incompatible'
  /** Unified hard filter: explicit requirement above the 2-year ceiling. */
  | 'experience_over_limit'
  /** Unified hard filter: senior/lead/manager role without a junior qualifier. */
  | 'seniority_excluded'
  | 'dead_link';

/**
 * A posting one of the two filters removed from the queue.
 *
 * The candidate asked for tech jobs open to juniors, so these are dropped
 * rather than down-ranked - but a filter he cannot inspect is a filter he
 * cannot debug or argue with, so every exclusion is reported with the score it
 * would have had, the filter that removed it, and the reason it lost.
 */
export interface ExcludedEntry {
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly url: string;
  readonly postedAt: string;
  /** Which filter removed it. The two mean very different things to the reader. */
  readonly excludedBy: ExclusionFilter;
  /** What this posting would have scored under the purely additive ranking. */
  readonly scoreBeforeGate: number;
  /** 0..1 domain-relevance confidence. Above the threshold for a junior exclusion. */
  readonly softwareRelevance: number;
  readonly reason: string;
}

export interface JobQueue {
  readonly generatedAt: string;
  readonly candidate: string;
  readonly totalFetched: number;
  /** Unique postings after dedupe, INCLUDING the ones the filters later excluded. */
  readonly totalUnique: number;
  /** Unique postings that passed filter A (software relevance). */
  readonly totalRelevant: number;
  /**
   * Unique postings that passed BOTH filters - the real size of the offer.
   *
   * Equal to `jobs.length` unless an explicit `--limit` truncated the list,
   * which is exactly why it is reported separately: the count the user is told
   * must be the count that exists, not the count that happened to be printed.
   */
  readonly totalJuniorEligible: number;
  readonly duplicatesRemoved: number;
  readonly sourceReports: readonly SourceReport[];
  readonly jobs: readonly QueueEntry[];
  /** Never truncated: `excluded.length` IS the exclusion count. */
  readonly excluded: readonly ExcludedEntry[];
  /**
   * What the liveness pass did. Absent on a queue written before this existed,
   * which is why it is optional rather than a `'off'`-valued required field: an
   * older `output/queue.json` must still load in the web app.
   */
  readonly liveness?: LivenessSummary;
}

/**
 * The liveness pass, as the numbers the CLI prints and the UI can reason about.
 *
 * `status` is separated from the counts deliberately. "Nothing was removed"
 * reads identically whether every posting is healthy or the checker never got
 * off the ground, and those two facts deserve very different reactions - the
 * same distinction `persist-queue.ts` draws between a real empty result and a
 * failed run.
 */
export interface LivenessSummary {
  readonly status:
    /** `--no-check-links`, or no checker wired in. Nothing was asked. */
    | 'off'
    /** The pass ran. The counts below are real. */
    | 'ran'
    /** The checker failed wholesale. NOTHING was removed - see `error`. */
    | 'failed';
  /** Postings whose address was actually checked. */
  readonly checked: number;
  readonly alive: number;
  readonly gone: number;
  /** Checked, but the answer proved nothing. Kept, and marked in the UI. */
  readonly unverified: number;
  /** Postings deleted from the list. Equal to `gone`. */
  readonly removed: number;
  /** Requests actually put on the wire this run. Should be near zero on a re-run. */
  readonly requests: number;
  /** Answers served from the TTL cache. */
  readonly fromCache: number;
  /** Why the pass failed, when `status` is `failed`. */
  readonly error?: string;
}

/** Driven port: persists the ranked queue somewhere. */
export interface QueueWriter {
  /** Returns a human-readable destination descriptor (e.g. a file path). */
  write(queue: JobQueue): Promise<string>;
}
