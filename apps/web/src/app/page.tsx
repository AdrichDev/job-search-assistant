import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  applicationRepository,
  buildFallbackQueue,
  cvModelRepository,
  dismissalRepository,
  queueReader,
  runStateStore,
} from '@/server/container';
import { loadDashboard } from '@/server/dashboard';
import { loadModelCatalog } from '@/server/model-catalog';
import { parseQueueFilters } from '@/lib/queue-filters';
import { sourceOptions } from '@/lib/source-labels';
import { readMailStatusNow } from '@/server/mail-status';
import { DismissedSection } from '@/components/dismissed-section';
import { FetchPanel } from '@/components/fetch-panel';
import { QueueView } from '@/components/queue-view';
import { StatsPanel } from '@/components/stats-panel';
import { ES } from '@/copy/es';

/**
 * Server component. Every read happens here, on the server; the browser
 * receives rendered data only - no credentials, no filesystem, no core imports.
 */

// The application log changes on every click, so a cached page would show the
// candidate a stale picture of their own actions.
export const dynamic = 'force-dynamic';

/** A banner the user is meant to act on, not a decorative alert. */
function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">{title}</p>
      {children}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  /*
   * The list's filters live in the address bar (UI-4), so the server parses them
   * once and hands the component its initial state: a reload or a shared link
   * lands on the same view instead of resetting to "everything".
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dashboard = await loadDashboard({
    queueReader: queueReader(),
    applicationRepository: applicationRepository(),
    dismissalRepository: dismissalRepository(),
    buildFallbackQueue,
    now: () => new Date(),
  });

  /*
   * Read on the server so a reload lands on the truth.
   *
   * A run started in another tab, or before a refresh, must be visible
   * immediately rather than only after the first poll - otherwise the panel
   * shows "idle" for two seconds over a pipeline that is very much running, and
   * invites a second click the server will have to refuse.
   */
  const fetchState = await runStateStore().read();
  /*
   * The confirmation modal lives on /seguimiento, so the home page has to say
   * that something is waiting there; a user who never opens the tracking page
   * would otherwise never learn a reply was detected. A read, never a write.
   */
  const mail = await readMailStatusNow();

  const { queue, stats, origin, sampleDataCount, dismissed, warnings } = dashboard;
  const initialFilters = parseQueueFilters(
    await searchParams,
    sourceOptions(queue.jobs).map((option) => option.id),
  );
  // Read once, and only when some application names a model: the stats table needs names.
  const modelCatalog = await loadModelCatalog(stats.byModel.length > 0 ? cvModelRepository() : undefined);
  const now = new Date(queue.generatedAt).getTime();
  const failedSources = queue.sourceReports.filter((report) => report.status === 'failed');

  /*
   * "Degraded" for the empty state means: the emptiness is not trustworthy.
   * The same distinction the write policy makes in the core - a run whose
   * sources failed says nothing about the job market - has to reach the screen,
   * otherwise the user reads an outage as "there are no jobs for me".
   */
  const degraded = failedSources.length > 0 || warnings.length > 0;

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mb-8">
                <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300">
          <span className="text-grad font-bold">✦</span>
          {ES.nav.pill.offers}
        </p>
<h1 className="text-4xl font-black tracking-tight text-[#f8fafc] sm:text-5xl">
          {ES.header.title}
        </h1>
        {mail.pendingCount > 0 && (
          <p className="mt-2 text-sm text-slate-600">
            {ES.mail.status.homePending(mail.pendingCount)}
            {' · '}
            <Link className="font-medium text-indigo-700 underline" href="/seguimiento#correo">
              {ES.mail.status.homeLink}
            </Link>
          </p>
        )}
      </header>

      {/*
        The offline catalogue is invented data whose links do not resolve. It
        used to be a grey clause at the end of a timestamp line; it is a banner
        now, because "these offers are not real" is not a footnote.
      */}
      {origin === 'offline-fallback' && (
        <Notice title={ES.header.offlineFallbackTitle}>
          <p className="prose-measure mt-1 leading-relaxed">{ES.header.offlineFallback}</p>
        </Notice>
      )}

      {/*
        THE CASE THE BANNER ABOVE COULD NOT SEE.

        `origin` describes where the queue came from, and a persisted run is a
        real run - so a queue file written by `--source=fixture`, or by the old
        `--source=all` that admitted the catalogue, rendered as trustworthy with
        dead apply buttons in it. This banner asks the data instead, so the same
        honesty applies whenever sample postings are PRESENT, not only when they
        are the sole source.

        Shown only for a persisted run: in the offline fallback the notice above
        already says it, and two amber boxes making the same point is how a
        person learns to skip amber boxes.
      */}
      {origin === 'persisted-run' && sampleDataCount > 0 && (
        <Notice title={ES.header.sampleDataTitle(sampleDataCount)}>
          <p className="prose-measure mt-1 leading-relaxed">
            {ES.header.sampleData(sampleDataCount, queue.jobs.length)}
          </p>
        </Notice>
      )}

      {warnings.length > 0 && (
        <Notice title={ES.degraded.title}>
          <ul className="mt-1 list-inside list-disc">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      )}

      {failedSources.length > 0 && (
        <Notice title={ES.degraded.failedTitle(failedSources.length)}>
          <p className="prose-measure mt-1 leading-relaxed">{ES.degraded.explanation}</p>
          <ul className="mt-2 list-inside list-disc">
            {failedSources.map((report) => (
              <li key={`${report.sourceId}-${report.query}`}>
                {report.sourceId} «{report.query}»: {report.error ?? ES.degraded.unknownError}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/*
        Above the stats and the list, because it is the control that CHANGES
        both of them. A "get new offers" button below the offers it would
        replace is a button nobody finds on the morning the list is stale.
      */}
      <FetchPanel initialState={fetchState} />

      <StatsPanel stats={stats} models={modelCatalog} />

      <QueueView entries={queue.jobs} now={now} degraded={degraded} initialFilters={initialFilters} />

      {/*
        Deliberately last and collapsed. These are decisions the human already
        made; the section exists so none of them is irreversible, not so they
        get a second look every visit.
      */}
      <DismissedSection rows={dismissed} />

      <footer className="mt-12 border-t border-slate-200 pt-4">
        <p className="prose-measure text-xs leading-relaxed text-slate-500">
          {ES.method.footerNote}
        </p>
      </footer>
    </main>
  );
}
