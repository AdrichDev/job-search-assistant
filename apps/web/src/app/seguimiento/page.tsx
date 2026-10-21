import type { Metadata } from 'next';
import { TrackingView } from '@/components/tracking-view';
import { ES } from '@/copy/es';
import { applicationRepository, cvModelRepository, queueReader } from '@/server/container';
import { revertNoticeFor } from '@/server/history';
import { filterTrackedRows, loadTracking, paginateRows, parseEstadoFilter, parsePagina } from '@/server/tracking';

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
  const page = parsePagina(query.pagina);
  const notice: { readonly text: string; readonly warning: boolean } | null =
    query.edicion === 'guardada'
      ? { text: ES.tracking.notice.saved, warning: false }
      : query.edicion === 'sin-cambios'
        ? { text: ES.tracking.notice.unchanged, warning: false }
        : query.edicion === 'sin-registro'
          ? { text: ES.tracking.notice.savedNotLogged, warning: true }
          : null;
  const undoNotice = revertNoticeFor(query.deshacer);
  const { rows, counts, warnings, documents, catalog } = await loadTracking({
    applicationRepository: applicationRepository(),
    queueReader: queueReader(),
    cvModelRepository: cvModelRepository(),
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
          className={
            notice.warning
              ? 'mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900'
              : 'mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900'
          }
        >
          {notice.text}
        </p>
      )}

      {undoNotice !== null && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900"
        >
          {undoNotice.text}
        </p>
      )}

      <TrackingView
        rows={rows}
        pagination={paginateRows(filterTrackedRows(rows, filter), page)}
        counts={counts}
        filter={filter}
        warnings={warnings}
        documents={documents}
        catalog={catalog}
      />
    </main>
  );
}
