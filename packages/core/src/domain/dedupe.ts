import { crossSourceKey } from './identity.js';
import type { Job, JobSourceRef } from './job.js';
import { locationKey, normalizeText } from './text.js';

export interface DedupeResult {
  readonly jobs: readonly Job[];
  readonly duplicatesRemoved: number;
}

/**
 * Every identity a vacancy can be recognized by.
 *
 * Four independent keys because boards are inconsistent: the same offer may
 * keep its URL but change its title, or keep its title but come from a
 * different source with a different id.
 *
 * The fourth one is what makes MULTI-SOURCE dedupe work. Once the same vacancy
 * can arrive from Adzuna and from the company's own Greenhouse board, all three
 * of the original keys miss it: the ids differ, the URLs differ (one is an
 * Adzuna redirect), and the exact-title fingerprint differs because one of them
 * appended `(m/f/d)`. `crossSourceKey` strips the decoration boards are known
 * to add and then demands an exact match - and returns `null` rather than a
 * loose key whenever it has no employer to anchor on. See `identity.ts` for why
 * this is exact-after-canonicalization rather than fuzzy.
 */
function keysFor(job: Job): string[] {
  const keys: string[] = [];

  /*
   * The content fingerprint is `company::title::place`, so with NO company it
   * degrades into `::junior developer::madrid` - a key that happily merges two
   * unrelated anonymous postings into one and deletes a real vacancy.
   *
   * Adzuna reaches that state on its own: its schema defaults `company` to the
   * empty string, which is how recruiter-posted ads routinely arrive. So an
   * anonymous posting is deduped only by URL and by source reference - both of
   * which still collapse the same ad seen twice on two pages, because that is
   * the same external id. What is given up is merging two ANONYMOUS ads across
   * sources, which is a case nothing can honestly decide.
   *
   * `job.id` itself is untouched: identity is still the fingerprint, so the
   * application log keeps linking. Only the merge decision changes.
   */
  if (normalizeText(job.company).length > 0) {
    keys.push(`fp:${job.id}`);
  }

  const url = normalizeText(job.url);
  if (url.length > 0) {
    keys.push(`url:${url}`);
  }

  for (const ref of job.sources) {
    keys.push(`src:${ref.sourceId}:${ref.externalId}`);
  }

  const crossSource = crossSourceKey({
    title: job.title,
    company: job.company,
    locationKey: locationKey(job.location),
  });
  if (crossSource !== null) {
    keys.push(crossSource);
  }

  return keys;
}

function mergeSources(
  a: readonly JobSourceRef[],
  b: readonly JobSourceRef[],
): readonly JobSourceRef[] {
  const seen = new Map<string, JobSourceRef>();
  for (const ref of [...a, ...b]) {
    seen.set(`${ref.sourceId}:${ref.externalId}`, ref);
  }
  return [...seen.values()];
}

/**
 * Keeps the first-seen job as the survivor but upgrades its data.
 *
 * `postedAt` takes the EARLIEST date on purpose: a repost should not let a
 * stale vacancy climb the ranking through the recency dimension.
 */
function merge(survivor: Job, duplicate: Job): Job {
  return {
    ...survivor,
    description:
      duplicate.description.length > survivor.description.length
        ? duplicate.description
        : survivor.description,
    url: survivor.url.length > 0 ? survivor.url : duplicate.url,
    postedAt:
      duplicate.postedAt.getTime() < survivor.postedAt.getTime()
        ? duplicate.postedAt
        : survivor.postedAt,
    salaryMin: survivor.salaryMin ?? duplicate.salaryMin,
    salaryMax: survivor.salaryMax ?? duplicate.salaryMax,
    contractType: survivor.contractType ?? duplicate.contractType,
    sources: mergeSources(survivor.sources, duplicate.sources),
  };
}

/**
 * Collapses the same vacancy arriving from several queries, pages or sources.
 *
 * First-seen order is preserved so the result stays stable across runs.
 */
export function dedupeJobs(jobs: readonly Job[]): DedupeResult {
  const slots: Job[] = [];
  const keyToSlot = new Map<string, number>();
  let duplicatesRemoved = 0;

  for (const job of jobs) {
    const keys = keysFor(job);
    let slotIndex: number | undefined;

    for (const key of keys) {
      const existing = keyToSlot.get(key);
      if (existing !== undefined) {
        slotIndex = existing;
        break;
      }
    }

    if (slotIndex === undefined) {
      slots.push(job);
      slotIndex = slots.length - 1;
    } else {
      const current = slots[slotIndex];
      if (current !== undefined) {
        slots[slotIndex] = merge(current, job);
      }
      duplicatesRemoved += 1;
    }

    // Register every key (old and new) against the surviving slot, so a later
    // job matching any of them lands on the same entry.
    const survivor = slots[slotIndex];
    if (survivor !== undefined) {
      for (const key of [...keys, ...keysFor(survivor)]) {
        keyToSlot.set(key, slotIndex);
      }
    }
  }

  return { jobs: slots, duplicatesRemoved };
}
