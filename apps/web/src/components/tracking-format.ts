import { ES, LOCALE } from '@/copy/es';
import { sourceLabel } from '@/lib/source-labels';

/** Pure presentation helpers for the tracking table (kept out of JSX so they are unit-tested). */

/**
 * Source labels of one tracked row.
 *
 * Imported history carries portal slugs that no adapter stamps, so they are
 * labelled here (and only for this view) instead of widening the queue's
 * "sources with a real adapter" list. An unmapped slug uses the row's own portal
 * text; with no portal text it still shows as unknown.
 */
export function trackingSourceLabels(row: {
  readonly sourceIds: readonly string[];
  readonly portal?: string;
}): string[] {
  if (row.sourceIds.length > 0) {
    // Imported rows carry the portal text the user typed in the spreadsheet; it is
    // the best label for a slug nobody mapped, and needs no list that falls behind.
    return row.sourceIds.map(
      (id) => ES.tracking.portalLabels[id] ?? (row.portal !== undefined ? row.portal : sourceLabel(id)),
    );
  }
  return [row.portal ?? ES.source.noSources];
}

/** Dates are shown in Spanish time, not in the server's timezone. */
export function formatTrackingDate(date: Date): string {
  return date.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
}
