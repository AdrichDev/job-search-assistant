import type { Job } from './job.js';
import { scoreJob } from './scoring/score-job.js';
import type { ScoredJob, ScoringConfig } from './scoring/types.js';

/**
 * Scoring and ordering, deliberately split into two functions.
 *
 * This module replaces the old `rankJobs`, which did both at once and ordered
 * by score. The product changed: the score is still computed and persisted -
 * the application-outcome analysis will need it to correlate score against
 * reply rate - but it no longer decides what the candidate reads first.
 *
 * Recency does. Two reasons, and only one of them is technical:
 *
 *  - A ranked list is a claim ("these are your best odds") that the pipeline
 *    cannot yet support with evidence. Nobody has measured reply rates.
 *  - "Newest first" is a fact about the data. It needs no justification, no
 *    breakdown panel, and no trust from the person reading it.
 *
 * Splitting the two is what keeps that honest: a function that scores AND sorts
 * cannot be reused by a caller that wants only one of the two, which is how a
 * ranking quietly reinstates itself.
 */

/** Scores every job. Order is the input's order: this function never sorts. */
export function scoreJobs(
  jobs: readonly Job[],
  config: ScoringConfig,
  now: Date,
): readonly ScoredJob[] {
  return jobs.map((job) => scoreJob(job, config, now));
}

/**
 * Newest first.
 *
 * Copies before sorting, so a caller's array is never reordered underneath it.
 * The `id` tie-break is not cosmetic: two postings published in the same second
 * are common on a board sweep, and without it the persisted queue file would
 * differ byte for byte between two runs over identical data.
 */
export function orderByRecency(scored: readonly ScoredJob[]): readonly ScoredJob[] {
  return [...scored].sort((a, b) => {
    const byDate = b.job.postedAt.getTime() - a.job.postedAt.getTime();
    return byDate !== 0 ? byDate : a.job.id.localeCompare(b.job.id);
  });
}
