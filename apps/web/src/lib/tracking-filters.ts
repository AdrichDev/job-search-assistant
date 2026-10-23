import { APPLICATION_OUTCOMES, isApplicationOutcome, isResponse } from '@job-queue/core/domain';
import type { ApplicationOutcome } from '@job-queue/core/domain';

/**
 * The tracking table's filters, as pure data — the tracking twin of
 * `queue-filters.ts`.
 *
 * The vocabulary is the user's own spreadsheet (`Candidaturas`): company, job
 * title, city, portal, state, whether anyone replied, and the two dates. The
 * columns that only exist as personal notes (address, phone, contact person,
 * list number, company briefing) are deliberately NOT filters: nobody searches
 * their history by phone number.
 *
 * Unlike the offer list, this filtering happens on the SERVER: the log can be
 * hundreds of rows and the page already re-renders per navigation. All the
 * module does is translate between the address bar and the rows, so a
 * combination survives a reload and a link can carry it.
 *
 * An unknown value never widens or crashes the page: it falls back to the
 * default instead of being passed through.
 */

export type EstadoFilter = ApplicationOutcome | 'all';
/** The spreadsheet's `¿Han contestado?`, as the two answers it can hold. */
export type RepliedFilter = 'all' | 'si' | 'no';

export interface TrackingFilters {
  /** `Nombre empresa`: case-insensitive substring. */
  readonly empresa: string;
  /** `Puesto / oferta`: case-insensitive substring. */
  readonly puesto: string;
  /** `Ciudad`: case-insensitive substring. */
  readonly ciudad: string;
  /** `Portal`: exact value, chosen from the portals the log actually holds. */
  readonly portal: string;
  /** `Estado`. */
  readonly estado: EstadoFilter;
  /** `¿Han contestado?`, derived from the outcome like the table column is. */
  readonly contestado: RepliedFilter;
  /** `Fecha solicitud` range, inclusive, ISO `YYYY-MM-DD`; '' means open. */
  readonly desde: string;
  readonly hasta: string;
  /** `Fecha publicación` range; only imported rows carry a publication date. */
  readonly publicadaDesde: string;
  readonly publicadaHasta: string;
  /** 1-based; only written to the URL when it is not the first page. */
  readonly pagina: number;
}

export const DEFAULT_TRACKING_FILTERS: TrackingFilters = {
  empresa: '',
  puesto: '',
  ciudad: '',
  portal: 'all',
  estado: 'all',
  contestado: 'all',
  desde: '',
  hasta: '',
  publicadaDesde: '',
  publicadaHasta: '',
  pagina: 1,
};

const REPLIED_VALUES: readonly string[] = ['all', 'si', 'no'];

/** Longest text filter accepted; generous, like the notes field. */
const MAX_TEXT_LENGTH = 120;

/** The structural slice of `TrackedApplication` the filters need. */
export interface TrackableApplicationRow {
  readonly company: string;
  readonly title: string;
  readonly city?: string;
  readonly portal?: string;
  readonly appliedAt: Date;
  readonly outcome: ApplicationOutcome;
  readonly publishedAt?: Date;
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

/** A text filter: trimmed, capped, never `undefined`. */
function text(value: string | string[] | undefined): string {
  return first(value).slice(0, MAX_TEXT_LENGTH);
}

/** Only a real calendar day in `YYYY-MM-DD` form passes; anything else is absent. */
function isoDay(value: string | string[] | undefined): string {
  const raw = first(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return '';
  }
  return Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? '' : raw;
}

/**
 * URL -> filters. `knownPortals` comes from the rows on screen, so a portal
 * that no longer appears resets to "todos" instead of showing an empty table
 * that looks like a data loss.
 */
export function parseTrackingFilters(
  params: Readonly<Record<string, string | string[] | undefined>>,
  knownPortals: readonly string[],
): TrackingFilters {
  const estado = first(params['estado']);
  const contestado = first(params['contestado']);
  const portal = first(params['portal']);

  return {
    empresa: text(params['empresa']),
    puesto: text(params['puesto']),
    ciudad: text(params['ciudad']),
    portal: knownPortals.includes(portal) ? portal : DEFAULT_TRACKING_FILTERS.portal,
    estado: (isApplicationOutcome(estado) ? estado : 'all') as EstadoFilter,
    contestado: (REPLIED_VALUES.includes(contestado) ? contestado : 'all') as RepliedFilter,
    desde: isoDay(params['desde']),
    hasta: isoDay(params['hasta']),
    publicadaDesde: isoDay(params['publicada-desde']),
    publicadaHasta: isoDay(params['publicada-hasta']),
    // Same rule as the page itself: anything unusable means the first page.
    pagina: /^[0-9]{1,4}$/.test(first(params['pagina'])) ? Math.max(1, Number(first(params['pagina']))) : 1,
  };
}

function matchesText(value: string | undefined, needle: string): boolean {
  return (value ?? '').toLowerCase().includes(needle);
}

/** The calendar day of a stored instant, in the same ISO form the URL carries. */
function isoDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function matchesDay(
  date: Date | undefined,
  desde: string,
  hasta: string,
): boolean {
  // A range on a facet the row does not carry can only exclude it: filtering by
  // publication date hides the queue-made rows, which have no such date.
  if (date === undefined) {
    return false;
  }
  const day = isoDayOf(date);
  return (desde === '' || day >= desde) && (hasta === '' || day <= hasta);
}

function matchesPortal(row: TrackableApplicationRow, portal: string): boolean {
  return portal === 'all' || row.portal === portal;
}

function matchesContestado(row: TrackableApplicationRow, contestado: RepliedFilter): boolean {
  return contestado === 'all' || (contestado === 'si') === isResponse(row.outcome);
}

function matchesEstado(row: TrackableApplicationRow, estado: EstadoFilter): boolean {
  return estado === 'all' || row.outcome === estado;
}

function matchesEveryTextFilter(
  row: TrackableApplicationRow,
  filters: TrackingFilters,
): boolean {
  const empresa = filters.empresa.trim().toLowerCase();
  const puesto = filters.puesto.trim().toLowerCase();
  const ciudad = filters.ciudad.trim().toLowerCase();
  return (
    (empresa === '' || matchesText(row.company, empresa)) &&
    (puesto === '' || matchesText(row.title, puesto)) &&
    (ciudad === '' || matchesText(row.city, ciudad))
  );
}

/**
 * Every filter combined with AND. The estado stays part of the combination so
 * pagination, links and the table all see exactly the same subset.
 */
export function filterTrackedRows<T extends TrackableApplicationRow>(
  rows: readonly T[],
  filters: TrackingFilters,
): readonly T[] {
  return rows.filter(
    (row) =>
      matchesEveryTextFilter(row, filters) &&
      matchesPortal(row, filters.portal) &&
      matchesContestado(row, filters.contestado) &&
      matchesEstado(row, filters.estado) &&
      (filters.desde === '' && filters.hasta === ''
        ? true
        : matchesDay(row.appliedAt, filters.desde, filters.hasta)) &&
      (filters.publicadaDesde === '' && filters.publicadaHasta === ''
        ? true
        : matchesDay(row.publishedAt, filters.publicadaDesde, filters.publicadaHasta)),
  );
}

/** A count for EVERY outcome, zeros included, so a filter link can always render. */
export function countOutcomes(
  rows: readonly TrackableApplicationRow[],
): Record<ApplicationOutcome, number> {
  const counts = Object.fromEntries(APPLICATION_OUTCOMES.map((outcome) => [outcome, 0])) as Record<
    ApplicationOutcome,
    number
  >;
  for (const row of rows) {
    counts[row.outcome] += 1;
  }
  return counts;
}

/**
 * The estado counts of the filter bar: computed under every OTHER active
 * filter, so the number next to each estado is how many of the rows you are
 * already looking at are in that estado — never how many the whole log holds.
 */
export function countUnderFilters(
  rows: readonly TrackableApplicationRow[],
  filters: TrackingFilters,
): Record<ApplicationOutcome, number> {
  return countOutcomes(filterTrackedRows(rows, { ...filters, estado: 'all' }));
}

/** One option per portal, counted like the source options of the offer list. */
export function portalOptions(
  rows: readonly TrackableApplicationRow[],
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.portal !== undefined) {
      counts.set(row.portal, (counts.get(row.portal) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'es'));
}

/** Filters -> query string (no leading `?`), only the values that differ from the default. */
export function trackingFiltersToQuery(filters: TrackingFilters): string {
  const params = new URLSearchParams();
  if (filters.empresa.trim().length > 0) {
    params.set('empresa', filters.empresa.trim());
  }
  if (filters.puesto.trim().length > 0) {
    params.set('puesto', filters.puesto.trim());
  }
  if (filters.ciudad.trim().length > 0) {
    params.set('ciudad', filters.ciudad.trim());
  }
  if (filters.portal !== DEFAULT_TRACKING_FILTERS.portal) {
    params.set('portal', filters.portal);
  }
  if (filters.estado !== DEFAULT_TRACKING_FILTERS.estado) {
    params.set('estado', filters.estado);
  }
  if (filters.contestado !== DEFAULT_TRACKING_FILTERS.contestado) {
    params.set('contestado', filters.contestado);
  }
  if (filters.desde !== '') {
    params.set('desde', filters.desde);
  }
  if (filters.hasta !== '') {
    params.set('hasta', filters.hasta);
  }
  if (filters.publicadaDesde !== '') {
    params.set('publicada-desde', filters.publicadaDesde);
  }
  if (filters.publicadaHasta !== '') {
    params.set('publicada-hasta', filters.publicadaHasta);
  }
  if (filters.pagina > 1) {
    params.set('pagina', String(filters.pagina));
  }
  const encoded = params.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}
