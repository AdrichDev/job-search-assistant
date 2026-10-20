import type { ChangeValue, HistoryField } from '@job-queue/core';
import { ES, LOCALE, cvVariantLabel } from '@/copy/es';
import { formatTrackingDate } from '@/components/tracking-format';

/**
 * Pure presentation helpers of the change history (kept out of JSX so they are
 * unit-tested). Truncation is for DISPLAY only: the history file keeps the full
 * value.
 */

const MAX_SHOWN_LENGTH = 140;

const DATE_FIELDS: readonly HistoryField[] = ['appliedAt', 'outcomeUpdatedAt', 'listing.publishedAt'];

export interface ShownValue {
  readonly text: string;
  /** True when there was no value ("vacío"). */
  readonly empty: boolean;
  /** Present (true) only when the text was cut for display. */
  readonly truncated?: true;
}

export function historyFieldLabel(field: HistoryField): string {
  return ES.history.fields[field] ?? field;
}

function cut(value: string): { text: string; truncated: boolean } {
  const chars = [...value];
  if (chars.length <= MAX_SHOWN_LENGTH) {
    return { text: value, truncated: false };
  }
  return { text: `${chars.slice(0, MAX_SHOWN_LENGTH).join('').trimEnd()}…`, truncated: true };
}

/** One before/after value as the person reads it. */
export function describeChangeValue(field: HistoryField, value: ChangeValue): ShownValue {
  const empty: ShownValue = { text: ES.history.emptyValue, empty: true };
  if (value === null) {
    return empty;
  }
  if (typeof value !== 'string') {
    return value.length === 0 ? empty : { text: value.join(', '), empty: false };
  }
  if (value.trim().length === 0) {
    return empty;
  }
  if (field === 'outcome') {
    return {
      text: ES.outcomeOption[value as keyof typeof ES.outcomeOption] ?? value,
      empty: false,
    };
  }
  if (field === 'cvVariant') {
    return { text: cvVariantLabel(value), empty: false };
  }
  if (DATE_FIELDS.includes(field)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? { text: value, empty: false }
      : { text: formatTrackingDate(date), empty: false };
  }
  const shown = cut(value);
  return shown.truncated
    ? { text: shown.text, empty: false, truncated: true }
    : { text: shown.text, empty: false };
}

/** Entry timestamps are shown with the hour, in Spanish time. */
export function formatHistoryDate(date: Date): string {
  return date.toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });
}
