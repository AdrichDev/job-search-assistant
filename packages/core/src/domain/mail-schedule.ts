/**
 * When the daily mail check is due, and when the Google token runs out.
 *
 * Pure: no I/O and no node builtins. The Madrid wall clock comes from
 * `Intl.DateTimeFormat` with the `timeZone` option, never from a hand-written
 * UTC offset, so the daylight-saving changes (last Sunday of March and October)
 * are handled by the platform's time-zone database. The machine's own time zone
 * is never consulted.
 */

export const MAIL_TIME_ZONE = 'Europe/Madrid';
export const MAIL_RUN_HOUR = 8;

/** Google refresh tokens of an app in testing mode expire after seven days. */
export const TOKEN_LIFETIME_DAYS = 7;

/** "Expiring" means this much time or less remains. */
const EXPIRING_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TokenStatus = 'unknown' | 'valid' | 'expiring' | 'expired';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MAIL_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function madridWallClock(instant: Date): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts['year'] ?? 0,
    month: parts['month'] ?? 0,
    day: parts['day'] ?? 0,
    hour: parts['hour'] ?? 0,
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

/** Milliseconds Madrid is ahead of UTC at `instant`. */
function madridOffsetMs(instant: Date): number {
  const wall = madridWallClock(instant);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Drop sub-second precision of the instant, which the formatter ignores.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which Madrid shows `hour`:00 on the given calendar day. */
function madridWallToInstant(year: number, month: number, day: number, hour: number): Date {
  const naive = Date.UTC(year, month - 1, day, hour);
  // Two passes: the offset at the guess may differ from the offset at the answer
  // when the guess falls on the other side of a clock change.
  let result = naive - madridOffsetMs(new Date(naive));
  result = naive - madridOffsetMs(new Date(result));
  return new Date(result);
}

/** The most recent 08:00 in Madrid at or before `now`. */
export function latestScheduledRun(now: Date): Date {
  const today = madridWallClock(now);
  const candidate = madridWallToInstant(today.year, today.month, today.day, MAIL_RUN_HOUR);
  if (candidate.getTime() <= now.getTime()) {
    return candidate;
  }
  // Date.UTC normalises day 0 to the last day of the previous month.
  const previous = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
  return madridWallToInstant(
    previous.getUTCFullYear(),
    previous.getUTCMonth() + 1,
    previous.getUTCDate(),
    MAIL_RUN_HOUR,
  );
}

/** True when no run has succeeded yet, or the last success predates the latest 08:00. */
export function isMailRunDue(now: Date, lastSuccessAt: Date | null): boolean {
  if (lastSuccessAt === null) {
    return true;
  }
  return lastSuccessAt.getTime() < latestScheduledRun(now).getTime();
}

export function tokenExpiresAt(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + TOKEN_LIFETIME_DAYS * DAY_MS);
}

export function tokenStatus(
  now: Date,
  issuedAt: Date | null,
  authFailedAt: Date | null,
): TokenStatus {
  if (authFailedAt !== null && (issuedAt === null || authFailedAt.getTime() > issuedAt.getTime())) {
    return 'expired';
  }
  if (issuedAt === null) {
    return 'unknown';
  }
  const remaining = tokenExpiresAt(issuedAt).getTime() - now.getTime();
  if (remaining <= 0) {
    return 'expired';
  }
  return remaining <= EXPIRING_WINDOW_MS ? 'expiring' : 'valid';
}

/** Minimum wait before an automatic retry after an attempt that did not succeed. */
export const MAIL_RETRY_COOLDOWN_MS = 30 * 60 * 1000;

function parseInstant(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Whether an automatic mail check may start now. `force` (the manual button)
 * always may. Otherwise a recent attempt blocks only when it did not end in a
 * success: a finished success is governed by `isMailRunDue`, not by the cooldown.
 * A future `lastAttemptAt` (clock skew) simply blocks until `now` reaches it plus
 * the cooldown, so it can never block forever.
 */
export function isMailCheckAllowed(
  now: Date,
  state: { readonly lastAttemptAt: string | null; readonly lastSuccessAt: string | null },
  options: { readonly force?: boolean } = {},
): boolean {
  if (options.force === true) {
    return true;
  }
  const attempt = parseInstant(state.lastAttemptAt);
  if (attempt === null) {
    return true;
  }
  const success = parseInstant(state.lastSuccessAt);
  if (success !== null && attempt <= success) {
    return true;
  }
  return now.getTime() - attempt >= MAIL_RETRY_COOLDOWN_MS;
}
