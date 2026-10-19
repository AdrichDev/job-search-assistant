'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FetchRunState, FetchRunSummary } from '@job-queue/core/domain';
import { fetchStateAction, startFetchAction } from '@/app/actions';
import { ES, LOCALE, translateActionMessage } from '@/copy/es';

/**
 * "Buscar ofertas": run the ingestion pipeline without opening a terminal.
 *
 * ## Terminology
 *
 * This FETCHES. It asks the same configured sources the CLI asks - public job
 * APIs and employer ATS endpoints - and it never navigates
 * or parses a job board's HTML. Calling it scraping in the copy would describe
 * something this program does not do and is not allowed to do.
 *
 * ## Why polling
 *
 * The run state has to be persisted on the server anyway: a second TAB must be
 * able to see that a run is in flight, and a reload must not lose it. Once the
 * state is a file the server can read, polling it is three lines and no
 * infrastructure. A stream would add a connection to keep alive, a reconnect
 * path and a fallback - all to shave a couple of seconds off the granularity of
 * a job measured in minutes. The interval is 2s while running and NOTHING at
 * all when idle, so a page left open overnight costs zero requests.
 *
 * ## Why the button is not the single-flight mechanism
 *
 * It is disabled while running, and that is a courtesy, not the guarantee. The
 * guarantee is the exclusive-create lock in the server (`fetch-run.ts`), because
 * a second tab has its own enabled button and a reloaded page has a fresh one.
 * This component is allowed to be wrong about the state; the server is not.
 */

const POLL_INTERVAL_MS = 2000;

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-4 w-4 shrink-0"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3 3" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
      fill="none"
    >
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The run report, in Spanish, from the numbers the core already computed.
 *
 * Every figure comes straight off `FetchRunSummary`, which `summarizeRun` reads
 * off the same queue the CLI prints. Nothing is recalculated here - a second
 * arithmetic would eventually disagree with the first.
 */
function RunSummary({ summary }: { summary: FetchRunSummary }) {
  const refused = summary.outcome === 'refused';

  return (
    <div className="mt-3 text-sm">
      <ul className="flex flex-col gap-0.5 text-slate-700">
        <li>{ES.fetch.fetched(summary.totalFetched)}</li>
        <li>{ES.fetch.deduped(summary.totalUnique, summary.duplicatesRemoved)}</li>
        <li>{ES.fetch.filteredNotSoftware(summary.excludedNotSoftware)}</li>
        <li>{ES.fetch.filteredByLocation(summary.excludedByLocation)}</li>
        <li>{ES.fetch.filteredNotJunior(summary.excludedNotJunior)}</li>
        {summary.removedAsGone > 0 && <li>{ES.fetch.removedAsGone(summary.removedAsGone)}</li>}
        <li className="font-medium text-slate-900">{ES.fetch.available(summary.offersAvailable)}</li>
      </ul>

      {summary.failedSources.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">
            {ES.fetch.failedSourcesHeading(summary.failedSources.length)}
          </p>
          <ul className="mt-1 list-inside list-disc">
            {summary.failedSources.map((source) => (
              <li key={`${source.sourceId}-${source.query}`}>
                {ES.fetch.failedSource(source.sourceId, source.query, source.error)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        THE WRITE GUARD, surfaced. A refused write is not a failure and must not
        read as one: it is the system declining to replace real postings with the
        emptiness a broken run produced. Saying so is the entire point of having
        the guard - a protection nobody is told about is indistinguishable from a
        bug.
      */}
      {refused && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="font-semibold">{ES.fetch.refusedHeading}</p>
          {summary.refusalReason !== null && (
            <p className="prose-measure mt-1 leading-relaxed">
              {ES.fetch.refusedDetail(summary.refusalReason)}
            </p>
          )}
          <p className="mt-1 font-medium">
            {summary.preservedJobCount === null
              ? ES.fetch.refusedPreservedUnknown
              : ES.fetch.refusedPreserved(summary.preservedJobCount)}
          </p>
        </div>
      )}

      {summary.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
          <p className="font-semibold">{ES.fetch.warningsHeading}</p>
          <ul className="mt-1 list-inside list-disc">
            {summary.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function FetchPanel({ initialState }: { initialState: FetchRunState }) {
  const [state, setState] = useState<FetchRunState>(initialState);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isStarting, startTransition] = useTransition();
  const router = useRouter();

  const running = state.status === 'running';
  // Read through a ref inside the poll so the effect does not re-subscribe on
  // every tick, which would reset the interval and poll far more often than
  // intended.
  const wasRunning = useRef(running);

  const poll = useCallback(async () => {
    const next = await fetchStateAction();
    setState(next);

    if (wasRunning.current && next.status !== 'running') {
      wasRunning.current = false;
      // The queue file has just changed. `refresh` re-renders the server
      // components with the new one, so the offers appear without the human
      // having to work out that they should reload.
      router.refresh();
    }
    if (next.status === 'running') {
      wasRunning.current = true;
    }
  }, [router]);

  useEffect(() => {
    if (!running) {
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [running, poll]);

  function handleStart() {
    startTransition(async () => {
      const result = await startFetchAction();
      setFeedback(translateActionMessage(result.message));
      // Reads the state back immediately rather than assuming the click won:
      // when it did not, this is what makes the panel show the run that is
      // actually in flight instead of a stale idle.
      await poll();
    });
  }

  const busy = running || isStarting;

  return (
    <section
      aria-labelledby="fetch-heading"
      className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="fetch-heading" className="text-sm font-semibold text-slate-900">
            {ES.fetch.action}
          </h2>
          <p className="prose-measure mt-1 text-xs leading-relaxed text-slate-500">
            {ES.fetch.hint}
          </p>
        </div>

        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          className={
            'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ' +
            'transition duration-150 motion-reduce:transition-none ' +
            (busy
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
              : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100')
          }
        >
          {busy ? <Spinner /> : <SearchIcon />}
          <span>{busy ? ES.fetch.pending : ES.fetch.action}</span>
          <span className="sr-only">{ES.fetch.screenReader}</span>
        </button>
      </div>

      {/*
        THE STATUS LINE.

        `aria-live="polite"` so a screen reader hears a run finish without losing
        focus. Every state is carried by WORDS, never by the spinner alone: the
        difference between "still working" and "finished" has to survive
        greyscale, a stopped animation and `prefers-reduced-motion`.
      */}
      <p aria-live="polite" className="mt-3 text-sm text-slate-700">
        {state.status === 'idle' && ES.fetch.statusIdle}
        {state.status === 'running' && ES.fetch.statusRunning(time(state.startedAt))}
        {state.status === 'finished' && ES.fetch.statusFinished(time(state.finishedAt))}
        {state.status === 'failed' && ES.fetch.statusFailed(time(state.finishedAt))}
      </p>

      {feedback !== null && !running && (
        <p className="mt-1 text-xs font-medium text-slate-600">{feedback}</p>
      )}

      {state.status === 'failed' && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="prose-measure leading-relaxed">{ES.fetch.failedDetail(state.error)}</p>
        </div>
      )}

      {state.status === 'finished' && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {ES.fetch.summaryHeading}
          </h3>
          <RunSummary summary={state.summary} />
        </>
      )}
    </section>
  );
}
