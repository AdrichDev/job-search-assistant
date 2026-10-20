import {
  APPLICATION_OUTCOMES,
  type Application,
  type ApplicationOutcome,
} from '../domain/application.js';

/**
 * The read model behind the tracking view: one row per application, whatever
 * its origin.
 *
 * Applications reach the UI from two directions. Imported history carries its
 * own `listing`. Applications made from the queue carry only a job id (the
 * content fingerprint `company::title::place`) and rely on the queue entry for
 * the facts - which stops working the day the job leaves the queue. The row
 * therefore resolves each fact through three fallbacks and never fails.
 */

/** The slice of a queue entry this view needs. Structural, so tests stay small. */
export interface TrackableQueueJob {
  readonly id: string;
  readonly company: string;
  readonly title: string;
  readonly location: string;
  readonly url: string;
  readonly sources: readonly { readonly sourceId: string }[];
}

export interface TrackedApplication {
  readonly jobId: string;
  /** May be empty when nothing could be recovered from an odd job id. */
  readonly company: string;
  readonly title: string;
  readonly url?: string;
  readonly city?: string;
  readonly sourceIds: readonly string[];
  readonly portal?: string;
  readonly appliedAt: Date;
  readonly outcome: ApplicationOutcome;
  readonly outcomeUpdatedAt: Date;
  readonly notes?: string;
  /** The spreadsheet's `Información breve empresa`, exactly as stored (newlines kept). Listing only. */
  readonly companyInfo?: string;
  /** Listing only; never derived for queue-made rows. */
  readonly publishedAt?: Date;
  readonly origin: 'imported' | 'queue';
}

const FINGERPRINT_SEPARATOR = '::';

/** Only http(s) links are ever rendered as links; anything else is dropped. */
function safeUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

interface Facts {
  readonly company: string;
  readonly title: string;
  readonly url: string | undefined;
  readonly city: string | undefined;
}

/** `company::title::place`, as stored. Total: an odd id yields the id as title. */
function parseFingerprint(jobId: string): Facts {
  const parts = jobId.split(FINGERPRINT_SEPARATOR);
  if (parts.length === 3) {
    const [company = '', title = '', place = ''] = parts;
    return {
      company: company.trim(),
      title: nonEmpty(title) ?? jobId,
      url: undefined,
      city: nonEmpty(place),
    };
  }
  return { company: '', title: jobId, url: undefined, city: undefined };
}

function resolveFacts(application: Application, queue: ReadonlyMap<string, TrackableQueueJob>): Facts {
  const { listing } = application;
  if (listing !== undefined) {
    return {
      company: listing.company,
      title: listing.title,
      url: safeUrl(listing.url),
      city: nonEmpty(listing.city),
    };
  }
  const entry = queue.get(application.jobId);
  if (entry !== undefined) {
    return {
      company: entry.company,
      title: entry.title,
      url: safeUrl(entry.url),
      city: nonEmpty(entry.location),
    };
  }
  return parseFingerprint(application.jobId);
}

export function buildTrackedApplications(
  applications: readonly Application[],
  queueJobs: readonly TrackableQueueJob[],
): TrackedApplication[] {
  const queue = new Map(queueJobs.map((entry) => [entry.id, entry]));

  const rows = applications.map((application): TrackedApplication => {
    const facts = resolveFacts(application, queue);
    const queueSources =
      application.listing === undefined
        ? [...new Set((queue.get(application.jobId)?.sources ?? []).map((ref) => ref.sourceId))]
        : [];
    const sourceIds = application.sourceIds.length > 0 ? application.sourceIds : queueSources;
    const portal = nonEmpty(application.listing?.portal);
    const notes = nonEmpty(application.notes);
    // Exact text, not trimmed: only blank values are dropped.
    const rawCompanyInfo = application.listing?.companyInfo;
    const companyInfo =
      rawCompanyInfo !== undefined && rawCompanyInfo.trim().length > 0 ? rawCompanyInfo : undefined;
    const publishedAt = application.listing?.publishedAt;

    return {
      jobId: application.jobId,
      company: facts.company,
      title: facts.title,
      ...(facts.url === undefined ? {} : { url: facts.url }),
      ...(facts.city === undefined ? {} : { city: facts.city }),
      sourceIds: [...sourceIds],
      ...(portal === undefined ? {} : { portal }),
      appliedAt: application.appliedAt,
      outcome: application.outcome,
      outcomeUpdatedAt: application.outcomeUpdatedAt,
      ...(notes === undefined ? {} : { notes }),
      ...(companyInfo === undefined ? {} : { companyInfo }),
      ...(publishedAt === undefined ? {} : { publishedAt }),
      origin: application.listing === undefined ? 'queue' : 'imported',
    };
  });

  return rows.sort(
    (a, b) =>
      b.appliedAt.getTime() - a.appliedAt.getTime() ||
      (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0),
  );
}

/** A count for EVERY outcome, zeros included, so a filter can always show all of them. */
export function countByOutcome(
  rows: readonly { readonly outcome: ApplicationOutcome }[],
): Record<ApplicationOutcome, number> {
  const counts = Object.fromEntries(
    APPLICATION_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<ApplicationOutcome, number>;
  for (const row of rows) {
    counts[row.outcome] += 1;
  }
  return counts;
}
