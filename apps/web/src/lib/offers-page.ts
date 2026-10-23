/**
 * Paging for the offer list.
 *
 * Ten per page, the same size the tracking table uses: one number to remember.
 * Generic over the row type because the list pages over `QueueEntry` today and
 * the analysis view will page over something else.
 *
 * `page` comes from the URL, so it is user-controlled: a zero, a negative, a NaN
 * or a page past the end all resolve to a page that exists instead of rendering
 * an empty list that reads like an outage.
 */
export const OFFERS_PAGE_SIZE = 10;

export interface OffersPage<T> {
  readonly page: number;
  readonly totalPages: number;
  readonly rows: readonly T[];
  readonly from: number;
  readonly to: number;
  readonly total: number;
}

export function paginateOffers<T>(rows: readonly T[], page: number): OffersPage<T> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / OFFERS_PAGE_SIZE));
  const requested = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const current = Math.min(requested, totalPages);
  const start = (current - 1) * OFFERS_PAGE_SIZE;
  const slice = rows.slice(start, start + OFFERS_PAGE_SIZE);

  return {
    page: current,
    totalPages,
    rows: slice,
    from: slice.length === 0 ? 0 : start + 1,
    to: slice.length === 0 ? 0 : start + slice.length,
    total,
  };
}
