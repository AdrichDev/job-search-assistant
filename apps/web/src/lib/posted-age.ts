import { LOCALE } from '@/copy/es';

/**
 * How long ago a posting was published, in the words a job board uses.
 *
 * The list asked for "cuando se ha publicado (día o hace cuantas horas)", so
 * the age is RELATIVE while it is recent and absolute once it is old enough
 * that nobody would parse "hace 9 días" correctly anyway. Same Spanish date
 * vocabulary as the tracking table's formatter: day, short month, year.
 *
 * Boundaries, stated once:
 *
 *   - under a minute (and any clock skew): "hace unos instantes"
 *   - under an hour:  "hace N minutos"
 *   - under a day:    "hace N horas"
 *   - 1–2 days:       "ayer" (calendar-free, 24–48h, so it stays monotonic)
 *   - under a week:   "hace N días"
 *   - a week or more: the absolute date
 */
export function formatPostedAge(postedAt: Date, now: number): string {
  const elapsed = Math.max(0, now - postedAt.getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) {
    return 'hace unos instantes';
  }
  if (minutes < 60) {
    return `hace ${minutes} minutos`;
  }
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) {
    return `hace ${hours} horas`;
  }
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 1) {
    return 'ayer';
  }
  if (days < 7) {
    return `hace ${days} días`;
  }
  return postedAt.toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
}
