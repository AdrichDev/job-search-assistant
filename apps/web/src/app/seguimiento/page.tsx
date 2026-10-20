import type { Metadata } from 'next';
import { TrackingView } from '@/components/tracking-view';
import { ES } from '@/copy/es';
import { applicationRepository, queueReader } from '@/server/container';
import { filterTrackedRows, loadTracking, parseEstadoFilter } from '@/server/tracking';

/** The application log changes on every click elsewhere; never serve a cached copy. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: ES.tracking.meta.title,
  description: ES.tracking.meta.description,
};

export default async function TrackingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filter = parseEstadoFilter(query.estado);
  const notice =
    query.edicion === 'guardada'
      ? ES.tracking.notice.saved
      : query.edicion === 'sin-cambios'
        ? ES.tracking.notice.unchanged
        : null;
  const { rows, counts, warnings } = await loadTracking({
    applicationRepository: applicationRepository(),
    queueReader: queueReader(),
  });

  return (
    <main id="seguimiento" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {ES.tracking.heading}
        </h1>
        <p className="prose-measure mt-2 text-sm leading-relaxed text-slate-600">
          {ES.tracking.intro}
        </p>
        <p className="mt-2 text-xs text-slate-500">{ES.tracking.total(rows.length)}</p>
      </header>

      {notice !== null && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900"
        >
          {notice}
        </p>
      )}

      <TrackingView
        rows={rows}
        visibleRows={filterTrackedRows(rows, filter)}
        counts={counts}
        filter={filter}
        warnings={warnings}
      />
    </main>
  );
}
