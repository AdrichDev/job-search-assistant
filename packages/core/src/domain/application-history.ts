import type { Application, ApplicationListing, ApplicationPatch, ListingPatch } from './application.js';
import type { ApplicationOutcome } from './application.js';
import type { CvVariant } from './job.js';

/**
 * Append-only change history of an application (CU7).
 *
 * Every edit that really changed something is one `ApplicationChange`: what
 * changed, before and after, when, and who/what did it. Nothing is ever edited
 * or deleted; undoing a change appends a new entry (source `revert`).
 *
 * Values are JSON-safe on purpose (string | string[] | null, dates as ISO
 * strings) so an entry can be stored and shown without knowing the entity.
 * Absent and null mean the same thing: "the field had no value".
 */

export const HISTORY_FIELDS = [
  'appliedAt',
  'outcome',
  'outcomeUpdatedAt',
  'cvVariant',
  'cvModelId',
  'letterModelId',
  'notes',
  'sourceIds',
  'listing.company',
  'listing.title',
  'listing.url',
  'listing.portal',
  'listing.city',
  'listing.address',
  'listing.phone',
  'listing.contact',
  'listing.companyInfo',
  'listing.publishedAt',
] as const;

export type HistoryField = (typeof HISTORY_FIELDS)[number];

export type ChangeValue = string | readonly string[] | null;

export interface FieldChange {
  readonly field: HistoryField;
  readonly before: ChangeValue;
  readonly after: ChangeValue;
}

export const CHANGE_SOURCES = ['manual', 'import', 'revert'] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

export interface ApplicationChange {
  /** Random and collision-safe; minted by the use case that records the change. */
  readonly id: string;
  readonly jobId: string;
  readonly at: Date;
  readonly source: ChangeSource;
  readonly changes: readonly FieldChange[];
  /** Set only on `revert` entries: the entry this one undoes. */
  readonly revertsId?: string;
}

export function isHistoryField(value: unknown): value is HistoryField {
  return typeof value === 'string' && (HISTORY_FIELDS as readonly string[]).includes(value);
}

/** The value of one loggable field of an application, as a JSON-safe value. */
export function fieldValue(application: Application, field: HistoryField): ChangeValue {
  switch (field) {
    case 'appliedAt':
      return application.appliedAt.toISOString();
    case 'outcome':
      return application.outcome;
    case 'outcomeUpdatedAt':
      return application.outcomeUpdatedAt.toISOString();
    case 'cvVariant':
      return application.cvVariant ?? null;
    case 'cvModelId':
      return application.cvModelId ?? null;
    case 'letterModelId':
      return application.letterModelId ?? null;
    case 'notes':
      return application.notes ?? null;
    case 'sourceIds':
      return [...application.sourceIds];
    case 'listing.publishedAt':
      return application.listing?.publishedAt?.toISOString() ?? null;
    default: {
      const key = field.slice('listing.'.length) as Exclude<keyof ApplicationListing, 'publishedAt'>;
      return application.listing?.[key] ?? null;
    }
  }
}

/** Value equality of two change values: absent = null, arrays by content. */
export function sameChangeValue(a: ChangeValue | undefined, b: ChangeValue | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === null || right === null) {
    return left === right;
  }
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right;
  }
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Every loggable field that differs. Empty when the two are equal. */
export function diffApplications(before: Application, after: Application): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of HISTORY_FIELDS) {
    const was = fieldValue(before, field);
    const now = fieldValue(after, field);
    if (!sameChangeValue(was, now)) {
      changes.push({ field, before: was, after: now });
    }
  }
  return changes;
}

/**
 * The patch that puts every `before` back, using the manual-edit semantics:
 * no value clears (cv null, optional text '', publishedAt null).
 *
 * Company and title can never be cleared, so when their `before` is null (the
 * entry created the listing) they are left out: undoing the creation of a
 * listing clears its optional fields but keeps company and title. Known
 * limitation, accepted instead of adding a "remove listing" capability.
 */
export function patchRestoring(changes: readonly FieldChange[]): ApplicationPatch {
  const patch: { -readonly [K in keyof ApplicationPatch]: ApplicationPatch[K] } = {};
  const listing: { -readonly [K in keyof ListingPatch]: ListingPatch[K] } = {};

  for (const { field, before } of changes) {
    const text = typeof before === 'string' ? before : null;
    switch (field) {
      case 'appliedAt':
        if (text !== null) patch.appliedAt = new Date(text);
        break;
      case 'outcome':
        if (text !== null) patch.outcome = text as ApplicationOutcome;
        break;
      case 'outcomeUpdatedAt':
        if (text !== null) patch.outcomeUpdatedAt = new Date(text);
        break;
      case 'cvVariant':
        patch.cvVariant = text === null ? null : (text as CvVariant);
        break;
      case 'cvModelId':
        patch.cvModelId = text;
        break;
      case 'letterModelId':
        patch.letterModelId = text;
        break;
      case 'notes':
        patch.notes = text ?? '';
        break;
      case 'sourceIds':
        patch.sourceIds = Array.isArray(before) ? [...before] : [];
        break;
      case 'listing.publishedAt':
        listing.publishedAt = text === null ? null : new Date(text);
        break;
      case 'listing.company':
      case 'listing.title':
        if (text !== null) listing[field.slice('listing.'.length) as 'company' | 'title'] = text;
        break;
      default:
        listing[field.slice('listing.'.length) as 'url'] = text ?? '';
    }
  }

  if (Object.keys(listing).length > 0) {
    patch.listing = listing;
  }
  return patch;
}

/* Undo rules -------------------------------------------------------------- */

export interface HistoryAnalysis {
  /** Entries whose effect was undone and still stands (shown as "deshecho"). */
  readonly reverted: ReadonlySet<string>;
  /** Ids that may be undone now, newest first. */
  readonly undoable: readonly string[];
}

/**
 * Which entries are undone and which may be undone now. `entries` are the
 * history of ONE application, newest first.
 *
 * Two entries can be undone at any moment: the newest live ordinary entry, and
 * the newest entry overall when it is itself an undo (undoing the undo). An
 * undone entry is never offered again; undoing an undo makes the original live
 * again. The caller still checks that the current values equal the entry's
 * `after`, which is what keeps changes made outside the log from being clobbered.
 */
export function analyzeHistory(entries: readonly ApplicationChange[]): HistoryAnalysis {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reverted = new Set<string>();

  for (const entry of [...entries].reverse()) {
    if (entry.revertsId === undefined) {
      continue;
    }
    reverted.add(entry.revertsId);
    const target = byId.get(entry.revertsId);
    if (target?.revertsId !== undefined) {
      // Undoing an undo: what that undo had reverted stands again.
      reverted.delete(target.revertsId);
    }
  }

  const undoable: string[] = [];
  const newest = entries[0];
  if (newest !== undefined && newest.revertsId !== undefined && !reverted.has(newest.id)) {
    undoable.push(newest.id);
  }
  const liveOrdinary = entries.find((entry) => entry.revertsId === undefined && !reverted.has(entry.id));
  if (liveOrdinary !== undefined) {
    undoable.push(liveOrdinary.id);
  }
  return { reverted, undoable };
}
