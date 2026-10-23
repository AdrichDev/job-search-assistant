/**
 * The offer list's filters, as pure data.
 *
 * They live in the URL for two reasons that are the user's, not the
 * implementer's: a reload no longer loses what you were looking at, and a link
 * can carry the view. Filtering itself stays in the browser (the queue is a few
 * dozen entries, so a round trip per keystroke buys nothing), which is why these
 * helpers only translate between the address bar and the component's state.
 *
 * An unknown value never widens what the page shows: it falls back to the
 * default instead of being passed through.
 */

export type AppliedFilter = 'all' | 'applied' | 'not_applied';

export interface QueueFilters {
  readonly cv: string;
  readonly fuente: string;
  readonly estado: AppliedFilter;
  readonly q: string;
  /** 1-based; only written to the URL when it is not the first page. */
  readonly pagina: number;
}

export const DEFAULT_QUEUE_FILTERS: QueueFilters = {
  cv: 'all',
  fuente: 'all',
  estado: 'all',
  q: '',
  pagina: 1,
};

const CV_VALUES: readonly string[] = ['all', 'frontend', 'microsoft', 'general'];
const ESTADO_VALUES: readonly string[] = ['all', 'applied', 'not_applied'];

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

/**
 * URL -> filters. `knownSources` comes from the entries on screen, so a source
 * that no longer exists in the queue resets to "todas" instead of showing an
 * empty list that looks like an outage.
 */
export function parseQueueFilters(
  params: Readonly<Record<string, string | string[] | undefined>>,
  knownSources: readonly string[],
): QueueFilters {
  const cv = first(params['cv']);
  const fuente = first(params['fuente']);
  const estado = first(params['estado']);
  const q = first(params['q']);

  return {
    cv: CV_VALUES.includes(cv) ? cv : DEFAULT_QUEUE_FILTERS.cv,
    fuente: fuente === 'all' || knownSources.includes(fuente) ? fuente : 'all',
    estado: (ESTADO_VALUES.includes(estado) ? estado : DEFAULT_QUEUE_FILTERS.estado) as AppliedFilter,
    q: q.slice(0, 120),
    // Same rule as the page itself: anything unusable means the first page.
    pagina: /^[0-9]{1,4}$/.test(first(params['pagina'])) ? Math.max(1, Number(first(params['pagina']))) : 1,
  };
}

/** Filters -> query string (no leading `?`), only the values that differ from the default. */
export function queueFiltersToQuery(filters: QueueFilters): string {
  const params = new URLSearchParams();
  if (filters.cv !== DEFAULT_QUEUE_FILTERS.cv) {
    params.set('cv', filters.cv);
  }
  if (filters.fuente !== DEFAULT_QUEUE_FILTERS.fuente) {
    params.set('fuente', filters.fuente);
  }
  if (filters.estado !== DEFAULT_QUEUE_FILTERS.estado) {
    params.set('estado', filters.estado);
  }
  const q = filters.q.trim();
  if (q.length > 0) {
    params.set('q', q);
  }
  if (filters.pagina > 1) {
    params.set('pagina', String(filters.pagina));
  }
  const encoded = params.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}
