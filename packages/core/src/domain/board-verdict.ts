import { jobSearchText, type Job } from './job.js';
import { scoreSoftwareRelevance } from './scoring/software-relevance.js';
import type { SoftwareRelevanceConfig } from './scoring/types.js';
import { normalizeText } from './text.js';

/**
 * IS THIS BOARD WORTH A REQUEST PER RUN?
 *
 * Every company board on the list costs at least one HTTP request on every
 * single run, forever, whether or not it ever produces a posting the candidate
 * can see. So admission is a decision, and this file is that decision written
 * down instead of made by eye.
 *
 * THREE BARS, and the order matters because each one is invisible to the one
 * before it:
 *
 *   1. REACHABLE     - the board answered at all.
 *   2. SPAIN         - it has openings located in Spain.
 *   3. SOFTWARE      - at least one of those is software engineering work.
 *
 * Bar 1 is not bar 2. On Greenhouse, Lever and Ashby a wrong slug 404s, so the
 * two questions collapse into one; on SmartRecruiters an unknown company
 * answers HTTP 200 with `totalFound: 0`, and `Telefonica`, `Glovo`, `Cabify`,
 * `Santander`, `Indra` and `Inditex` all "succeeded" while being nothing.
 *
 * Bar 2 is not bar 3. `Sixt` had 35 Spanish openings and every one of them was
 * a car rental agent; `Accor` had 15 hotel receptionists. Both would have
 * passed a check that stopped at "is it hiring here". A board whose entire
 * Spanish presence is discarded by the software gate downstream is still a
 * request per run that can never pay for itself.
 *
 * ## WHY THIS REUSES `scoreSoftwareRelevance` INSTEAD OF READING TITLES
 *
 * Because the gate that admits a BOARD and the gate that admits a POSTING have
 * to be the same gate. If they differ, the list fills with boards whose every
 * posting is thrown away one layer later - and nothing would ever complain,
 * because from the outside that looks identical to a quiet job market.
 *
 * It also matters in the other direction, which is the whole point of the
 * Microsoft-partner sweep: a Spanish consultancy titles the role "Consultor/a
 * Junior" and names Dynamics 365 and Power Apps only in the body. Judging a
 * board by its titles would reject precisely the postings this candidate is
 * most competitive for.
 */

export type BoardVerdict =
  | 'pass'
  | 'unreachable'
  | 'no-spain-openings'
  | 'no-software-openings';

export interface BoardProbe {
  /** Non-null when the board could not be read at all. */
  readonly error: string | null;
  /** Postings the location filter kept. */
  readonly spainOpenings: number;
  /** How many of those the software gate accepts. */
  readonly softwareOpenings: number;
}

/**
 * The pipeline's own software gate, applied to one posting.
 *
 * The normalized inputs are built exactly as `scoreJob` builds them - same
 * title, same title+company+location+description haystack - so a posting can
 * never be counted here and then rejected there.
 */
export function isSoftwareOpening(job: Job, config: SoftwareRelevanceConfig): boolean {
  return scoreSoftwareRelevance(
    { normalizedTitle: normalizeText(job.title), normalizedText: jobSearchText(job) },
    config,
  ).isSoftware;
}

/** The software postings on a board, in the order the board reported them. */
export function softwareOpenings(
  jobs: readonly Job[],
  config: SoftwareRelevanceConfig,
): readonly Job[] {
  return jobs.filter((job) => isSoftwareOpening(job, config));
}

/**
 * Which bar a probed board failed, or `pass`.
 *
 * A single verdict rather than a boolean because the three failures mean
 * completely different things to whoever is reading the sweep: `unreachable`
 * usually means the company is not on that ATS, `no-spain-openings` means it is
 * there but not hiring here (or, on SmartRecruiters, is not there at all), and
 * `no-software-openings` means it is a real Spanish employer of the wrong kind.
 */
export function judgeBoardVerdict(probe: BoardProbe): BoardVerdict {
  if (probe.error !== null) {
    return 'unreachable';
  }
  if (probe.spainOpenings === 0) {
    return 'no-spain-openings';
  }
  if (probe.softwareOpenings === 0) {
    return 'no-software-openings';
  }
  return 'pass';
}
