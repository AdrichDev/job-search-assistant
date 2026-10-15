import { normalizeText, locationKey } from './text.js';

/**
 * Which CV / cover-letter variant this vacancy should be answered with.
 * Decided by the winning stack lane during scoring; consumed later by the
 * (not yet built) tailoring layer.
 */
export type CvVariant = 'frontend' | 'microsoft' | 'general';

/** Where a vacancy was seen. The same vacancy can carry several refs after dedupe. */
export interface JobSourceRef {
  readonly sourceId: string;
  readonly externalId: string;
  readonly url: string;
}

/** Normalized vacancy. This is the only job shape the domain and the app layer know about. */
export interface Job {
  /** Stable content fingerprint: company + title + coarse location. Also the dedupe key. */
  readonly id: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly description: string;
  readonly url: string;
  readonly postedAt: Date;
  readonly salaryMin: number | null;
  readonly salaryMax: number | null;
  readonly contractType: string | null;
  readonly sources: readonly JobSourceRef[];
}

/** Everything an adapter must provide to mint a domain `Job`. */
export interface JobDraft {
  readonly sourceId: string;
  readonly externalId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly description: string;
  readonly url: string;
  readonly postedAt: Date;
  readonly salaryMin?: number | null;
  readonly salaryMax?: number | null;
  readonly contractType?: string | null;
}

/**
 * Content fingerprint used for cross-source deduplication.
 * Deliberately coarse: the same vacancy republished with a slightly different
 * description must still collapse into one entry.
 */
export function jobFingerprint(draft: {
  title: string;
  company: string;
  location: string;
}): string {
  const title = normalizeText(draft.title);
  const company = normalizeText(draft.company);
  const place = locationKey(draft.location);
  return `${company}::${title}::${place}`;
}

/** The only schemes a browser can open from the queue file. */
const APPLYABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * The posting's own URL, or a loud failure.
 *
 * This is the ONE field the candidate acts on. A wrong title costs a second of
 * reading; a wrong URL sends a human to an HTTP 403 and teaches them the tool
 * lies to them. So there is no default, no repair and no placeholder here:
 * a posting the pipeline cannot open is not a posting it may show.
 *
 * The rule this enforces, stated once for the whole codebase:
 *
 *   A job's URL is the source payload's own URL field, or the job does not
 *   exist. It is never derived from the title, the id, the company, or any
 *   other field.
 *
 * Enforced in the DOMAIN rather than per adapter on purpose. Every path into
 * the system - Adzuna, three company boards, the offline fixture, any future
 * source, and any test helper - mints its jobs through `createJob`, so this is
 * the single place where the invariant cannot be forgotten.
 */
function requireSourceUrl(draft: JobDraft): string {
  const url = draft.url.trim();
  const context = `[${draft.sourceId}] "${draft.title}"`;

  if (url.length === 0) {
    throw new Error(
      `${context}: the source returned no URL. A posting with no URL is not a posting; ` +
        'it must be skipped at the boundary, never given a synthesised one.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `${context}: "${url}" is not an absolute URL. Only the source's own absolute URL is usable.`,
    );
  }

  if (!APPLYABLE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `${context}: "${url}" is not an http(s) URL, so no apply button could open it.`,
    );
  }

  return url;
}

/**
 * Adapters call this instead of building `Job` literals, so normalization,
 * fingerprinting and URL provenance live in exactly one place (the domain).
 *
 * Throws when the draft carries no usable source URL. Adapters are expected to
 * catch that, skip the posting and say so - a malformed row is not a malformed
 * run.
 */
export function createJob(draft: JobDraft): Job {
  const title = draft.title.trim();
  const company = draft.company.trim();
  const location = draft.location.trim();
  const url = requireSourceUrl(draft);

  return {
    id: jobFingerprint({ title, company, location }),
    title,
    company,
    location,
    description: draft.description.trim(),
    url,
    postedAt: draft.postedAt,
    salaryMin: draft.salaryMin ?? null,
    salaryMax: draft.salaryMax ?? null,
    contractType: draft.contractType ?? null,
    // The same validated string, not a second derivation of it: two fields that
    // are meant to be identical must not be computed twice.
    sources: [
      {
        sourceId: draft.sourceId,
        externalId: draft.externalId,
        url,
      },
    ],
  };
}

/** Single normalized haystack used by every scoring dimension. */
export function jobSearchText(job: Job): string {
  return normalizeText(`${job.title} ${job.company} ${job.location} ${job.description}`);
}
