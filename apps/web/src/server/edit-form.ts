import type { Application, TrackedApplication } from '@job-queue/core';

/**
 * Shared vocabulary of the manual-edit form: which fields exist, how a date is
 * written in a form (`YYYY-MM-DD`) and how a stored application is turned into
 * the pre-filled values. Pure and free of Next.js so both the server action and
 * the page can use it, and tests can reach it.
 */

/** Every text field the form posts, in display order. All values are strings. */
export const EDIT_FORM_FIELDS = [
  'appliedAt',
  'outcome',
  'outcomeUpdatedAt',
  'cvVariant',
  'notes',
  'sourceIds',
  'company',
  'title',
  'url',
  'portal',
  'city',
  'address',
  'phone',
  'contact',
  'companyInfo',
  'publishedAt',
] as const;

export type EditFormField = (typeof EDIT_FORM_FIELDS)[number];

/** What the form shows: the job id plus one string per field. */
export type EditFormValues = Readonly<Record<EditFormField | 'jobId', string>>;

const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar day a person in Spain sees for this instant, as `YYYY-MM-DD`. */
export function madridDay(date: Date): string {
  return DAY_FORMATTER.format(date);
}

/** `YYYY-MM-DD` -> that day at 00:00 UTC, or null when it is not a real calendar day. */
export function parseFormDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date : null;
}

/**
 * Current values as form strings.
 *
 * A queue-made application has no listing of its own: company, title, city and
 * link are shown from the tracked row (queue entry or the id fingerprint), so the
 * person can correct them, and saving then materialises a listing from what was
 * on screen.
 */
export function buildEditFormValues(
  application: Application,
  row: TrackedApplication | undefined,
): EditFormValues {
  const { listing } = application;
  const sourceIds = application.sourceIds.length > 0 ? application.sourceIds : (row?.sourceIds ?? []);

  return {
    jobId: application.jobId,
    appliedAt: madridDay(application.appliedAt),
    outcome: application.outcome,
    outcomeUpdatedAt: madridDay(application.outcomeUpdatedAt),
    cvVariant: application.cvVariant ?? '',
    notes: application.notes ?? '',
    sourceIds: sourceIds.join(', '),
    company: listing?.company ?? row?.company ?? '',
    title: listing?.title ?? row?.title ?? '',
    url: listing?.url ?? row?.url ?? '',
    portal: listing?.portal ?? '',
    city: listing?.city ?? row?.city ?? '',
    address: listing?.address ?? '',
    phone: listing?.phone ?? '',
    contact: listing?.contact ?? '',
    companyInfo: listing?.companyInfo ?? '',
    publishedAt: listing?.publishedAt === undefined ? '' : madridDay(listing.publishedAt),
  };
}
