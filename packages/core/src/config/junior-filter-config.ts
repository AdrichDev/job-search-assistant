import type { JuniorFilterConfig } from '../domain/junior-eligibility.js';

/**
 * FILTER B vocabulary: the only words allowed to delete a posting on seniority.
 *
 * Deliberately NOT `ScoringConfig.seniority.seniorTerms`, and the separation is
 * the point rather than an oversight. That list exists to apply a soft PENALTY
 * and can afford to be generous - it contains `manager`, `experto`,
 * `especialista senior`, `amplia experiencia`, `experiencia demostrable`. As a
 * nudge those are fine. As a delete they would silently swallow every posting
 * that merely says "se valora experiencia demostrable en React", which is most
 * of the Spanish market, junior ads included.
 *
 * So this list is short, explicit, and hard to argue with. Every entry names a
 * rank that a first-job candidate is definitively not being hired into.
 *
 * The bar for adding a term: a hiring manager would agree that a person with
 * zero professional years cannot hold this title. "Probably too senior" does
 * not clear that bar and does not belong here - the candidate said he would do
 * the judging.
 */
export const DEFAULT_JUNIOR_FILTER_CONFIG: JuniorFilterConfig = {
  /**
   * Checked against the TITLE ONLY.
   *
   * A body is allowed to say "you will work alongside our senior engineers" or
   * "reports to the Head of Engineering" without that being a requirement on
   * the reader. A title is the role being offered, so it is the only place a
   * seniority word is unambiguously about the candidate.
   */
  disqualifyingTitleTerms: [
    'senior',
    'lead',
    'tech lead',
    'team lead',
    'principal',
    'staff',
    'head of',
    'architect',
    // Spanish spelling of the same rank. Without it, "Arquitecto de Software"
    // - which is how the Madrid market actually writes it - walks straight in.
    'arquitecto',
    /*
     * `director` and `jefe de` are additions beyond the six terms the candidate
     * listed, and they are here because a real board run put
     * "Global Director of Revenue Enablement (Remote Europe)" second in his
     * list. It cleared Filter A on n8n and GitHub keywords and cleared Filter B
     * because nobody had written "director" down.
     *
     * They belong to the same category as `head of` - a rank nobody is hired
     * into as a first job - so admitting them does not widen the filter's
     * meaning, it completes it.
     *
     * `manager` and `responsable de` were considered and REJECTED. Both are
     * genuinely ambiguous in this market ("Junior Project Manager", "Responsable
     * de un módulo") and the filter's whole premise is that it only fires on
     * signals nobody would argue with.
     */
    'director',
    'directora',
    'jefe de',
    'jefa de',
  ],

  /**
   * Years of experience at or above which the posting is excluded.
   *
   * 3 is the number the candidate gave. Note what it means in practice: an ad
   * asking for 2 years is KEPT, because a motivated junior answering a 2-year
   * ad is a normal, sometimes successful thing, and the cost of being wrong is
   * two seconds of scrolling.
   */
  maxYearsRequired: 3,
  /*
   * `manager` WAS rejected above as a blanket delete, and it still is: the hard
   * eligibility filter excludes it only when the title carries no junior-level
   * word. "Junior Project Manager" and "Associate Product Manager" survive;
   * "Engineering Manager" does not.
   */
  managerTitleTerms: ['manager', 'gerente'],
  managerExemptTitleTerms: [
    'junior',
    'jr',
    'entry level',
    'entry-level',
    'graduate',
    'trainee',
    'associate',
    'becario',
    'becaria',
    'practicas',
  ],

  /**
   * Explicitly foreign locations. Matched against the location FIELD only, so a
   * body that says "our US customers" can never delete a Madrid posting.
   */
  foreignLocationTerms: [
    'united states',
    'usa',
    'u.s.',
    'united kingdom',
    'uk',
    'england',
    'london',
    'germany',
    'berlin',
    'munich',
    'france',
    'paris',
    'portugal',
    'lisbon',
    'lisboa',
    'porto',
    'netherlands',
    'amsterdam',
    'ireland',
    'dublin',
    'italy',
    'milan',
    'poland',
    'warsaw',
    'canada',
    'mexico',
    'argentina',
    'brazil',
    'india',
    'australia',
    'singapore',
    'switzerland',
    'zurich',
    'sweden',
    'stockholm',
    'denmark',
    'copenhagen',
    'belgium',
    'brussels',
    'austria',
    'vienna',
    'colombia',
    'chile',
    'latam',
  ],

  worldwideLocationTerms: ['worldwide', 'anywhere', 'global', 'europe', 'emea', 'eu', 'european union'],
};
