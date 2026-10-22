'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { QueueEntry } from '@job-queue/core/domain';
import { EmptyQueue } from '@/components/empty-queue';
import { JobCard } from '@/components/job-card';
import { ES } from '@/copy/es';
import { matchesSource, sourceOptions } from '@/lib/source-labels';
import { queueFiltersToQuery, type AppliedFilter, type QueueFilters } from '@/lib/queue-filters';

/**
 * Filtering happens in the browser over data the server already sent.
 *
 * The queue is at most a few dozen entries, so a round trip per keystroke would
 * be pure latency for no benefit. Nothing sensitive is involved: the client
 * only ever holds the same public posting data the page already renders.
 */

const CV_OPTIONS = [
  { value: 'all', label: ES.queue.cvOptionAll },
  { value: 'frontend', label: ES.cvVariant.frontend },
  { value: 'microsoft', label: ES.cvVariant.microsoft },
  { value: 'general', label: ES.cvVariant.general },
] as const;

const APPLIED_OPTIONS: readonly { value: AppliedFilter; label: string }[] = [
  { value: 'all', label: ES.queue.statusOptionAll },
  { value: 'not_applied', label: ES.queue.statusOptionPending },
  { value: 'applied', label: ES.queue.statusOptionApplied },
];

const FIELD =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition ' +
  'hover:border-slate-400 motion-reduce:transition-none';

function matchesSearch(entry: QueueEntry, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }
  const haystack = [entry.title, entry.company, entry.location, ...entry.requirements.matchedStack]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

export function QueueView({
  entries,
  now,
  degraded,
  initialFilters,
}: {
  entries: readonly QueueEntry[];
  now: number;
  degraded: boolean;
  initialFilters: QueueFilters;
}) {
  const [cvVariant, setCvVariant] = useState<string>(initialFilters.cv);
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>(initialFilters.estado);
  const [source, setSource] = useState<string>(initialFilters.fuente);
  const [search, setSearch] = useState(initialFilters.q);

  /*
   * The state is the source of truth and the URL follows it, with
   * `history.replaceState` rather than a router navigation: filtering is local,
   * so the server has nothing to re-render and a navigation per keystroke would
   * be pure latency. `replace` (not `push`) keeps the back button about pages,
   * not about every character typed into the search box.
   */
  useEffect(() => {
    const query = queueFiltersToQuery({
      cv: cvVariant,
      fuente: source,
      estado: appliedFilter,
      q: search,
    });
    const next = `${window.location.pathname}${query}`;
    if (`${window.location.pathname}${window.location.search}` === next) {
      return;
    }
    window.history.replaceState(null, '', next);
  }, [cvVariant, source, appliedFilter, search]);

  const searchId = useId();
  const cvId = useId();
  const appliedId = useId();
  const sourceId = useId();
  const sources = useMemo(() => sourceOptions(entries), [entries]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return entries.filter((entry) => {
      if (cvVariant !== 'all' && entry.cvVariant !== cvVariant) {
        return false;
      }
      if (!matchesSource(entry, source)) {
        return false;
      }
      const isApplied = entry.applicationStatus !== 'not_applied';
      if (appliedFilter === 'applied' && !isApplied) {
        return false;
      }
      if (appliedFilter === 'not_applied' && isApplied) {
        return false;
      }
      return matchesSearch(entry, needle);
    });
  }, [entries, cvVariant, source, appliedFilter, search]);

  return (
    <section aria-labelledby="queue-heading" id="queue" className="scroll-mt-4">
      {/*
        The total leads the section, and it is a count of OFFERS, not a score.
        The old heading was a small grey "Cola ordenada" over a list whose first
        visible element was a number out of 100; the first thing the reader now
        learns is how many offers exist for them.
      */}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="queue-heading" className="text-xl font-semibold text-slate-900">
          {ES.queue.total(entries.length)}
        </h2>
        <p className="text-sm text-slate-500">{ES.queue.orderingNote}</p>
      </div>

      {/*
        The whole queue is empty: an API outage or a genuinely empty market.
        Filters would be furniture with nothing to filter, so they are not shown.
      */}
      {entries.length === 0 ? (
        <EmptyQueue degraded={degraded} />
      ) : (
        <>
          <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
              <label htmlFor={searchId} className="text-xs font-medium text-slate-600">
                {ES.queue.searchLabel}
              </label>
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={ES.queue.searchPlaceholder}
                className={`${FIELD} placeholder:text-slate-400`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={cvId} className="text-xs font-medium text-slate-600">
                {ES.queue.cvLabel}
              </label>
              <select
                id={cvId}
                value={cvVariant}
                onChange={(event) => setCvVariant(event.target.value)}
                className={FIELD}
              >
                {CV_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={sourceId} className="text-xs font-medium text-slate-600">
                {ES.queue.sourceLabel}
              </label>
              <select
                id={sourceId}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                className={FIELD}
              >
                <option value="all">{ES.queue.sourceOptionAll(entries.length)}</option>
                {sources.map((option) => (
                  <option key={option.id} value={option.id}>
                    {ES.queue.sourceOption(option.label, option.count)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={appliedId} className="text-xs font-medium text-slate-600">
                {ES.queue.statusLabel}
              </label>
              <select
                id={appliedId}
                value={appliedFilter}
                onChange={(event) => setAppliedFilter(event.target.value as AppliedFilter)}
                className={FIELD}
              >
                {APPLIED_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p aria-live="polite" className="mb-3 text-sm text-slate-600">
            {ES.queue.showing(visible.length, entries.length)}
          </p>

          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <p className="text-sm font-medium text-slate-700">{ES.queue.noMatches}</p>
              <p className="mt-1 text-sm text-slate-500">{ES.queue.noMatchesHint}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <JobCard entry={entry} now={now} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
