import type { Metadata } from 'next';
import { isMailCheckAllowed, isMailRunDue, consoleLogger, type MailProposal } from '@job-queue/core';
import { MailCatchUp } from '@/components/mail-catchup';
import { MailProposalsModal, type MailModalRow } from '@/components/mail-proposals-modal';
import { TrackingView } from '@/components/tracking-view';
import { LOCALE, ES } from '@/copy/es';
import {
  acceptMailProposalAction,
  checkMailNowAction,
  dismissMailProposalAction,
} from '@/app/mail-actions';
import { applicationRepository, cvModelRepository, mailProposalRepository, queueReader } from '@/server/container';
import { revertNoticeFor } from '@/server/history';
import { mailNoticeFor } from '@/server/mail-notices';
import { readMailStatusNow } from '@/server/mail-status';
import { loadTracking, paginateRows, parsePagina } from '@/server/tracking';
import {
  countUnderFilters,
  filterTrackedRows,
  parseTrackingFilters,
  portalOptions,
} from '@/lib/tracking-filters';

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
  const { rows, warnings, documents, catalog } = await loadTracking({
    applicationRepository: applicationRepository(),
    queueReader: queueReader(),
    cvModelRepository: cvModelRepository(),
  });

  /*
   * The filter vocabulary is the spreadsheet's own (S1). The estado counts the
   * filter bar shows are computed under every OTHER active filter, so each
   * number says how many of the rows you are already looking at hold that
   * estado - never how many the whole log holds.
   */
  const portals = portalOptions(rows);
  const filters = parseTrackingFilters(
    query,
    portals.map((option) => option.value),
  );
  const baseRows = filterTrackedRows(rows, { ...filters, estado: 'all' });
  const filteredRows = filterTrackedRows(rows, filters);

  /*
   * Mail (U5d): a READ of the mail state, the pending proposals, and the
   * notice the redirect slug stands for. Nothing here writes: the catch-up is
   * fired by the client component after mount, the modal opens after mount,
   * and the only mutations are explicit form posts.
   */
  const mailNotice = mailNoticeFor(query.correo, {
    aplicados: query.aplicados,
    'sin-registro': query['sin-registro'],
    conflicto: query.conflicto,
    'ya-decididas': query['ya-decididas'],
    'sin-postulacion': query['sin-postulacion'],
    rechazadas: query.rechazadas,
    'no-encontradas': query['no-encontradas'],
  });

  const mailStatus = await readMailStatusNow();

  let pending: readonly MailProposal[] = [];
  try {
    pending = await mailProposalRepository().listPending();
  } catch (cause: unknown) {
    // The count above still tells the truth; the list just stays empty.
    consoleLogger.error(
      `Mail proposals unreadable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const rowsByJob = new Map(rows.map((row) => [row.jobId, row]));
  const modalRows: readonly MailModalRow[] = pending.map((proposal) => {
    const tracked = rowsByJob.get(proposal.jobId);
    return {
      id: proposal.id,
      company: tracked ? tracked.company : ES.mail.status.unknownApplication,
      title: tracked?.title ?? '',
      currentState: tracked ? ES.outcomeOption[tracked.outcome] : null,
      proposedState: ES.outcomeOption[proposal.proposedOutcome],
      snippet: proposal.snippet,
    };
  });

  /* `due` is a read, like the rest: the component decides after mount. */
  const mailNow = new Date();
  const parsedSuccess =
    mailStatus.lastSuccessAt === null ? null : new Date(mailStatus.lastSuccessAt);
  const lastSuccess =
    parsedSuccess !== null && Number.isNaN(parsedSuccess.getTime()) ? null : parsedSuccess;
  const mailDue =
    mailStatus.configured &&
    !mailStatus.stateCorrupt &&
    isMailRunDue(mailNow, lastSuccess) &&
    isMailCheckAllowed(mailNow, {
      lastAttemptAt: mailStatus.lastAttemptAt,
      lastSuccessAt: mailStatus.lastSuccessAt,
    });
  const lastCheck =
    lastSuccess === null
      ? null
      : new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(
          lastSuccess,
        );

  return (
    <main id="seguimiento" className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
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

      {mailNotice !== null && (
        <p
          id="correo"
          role="status"
          className={
            mailNotice.tone === 'ok'
              ? 'mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900'
              : mailNotice.tone === 'warning'
                ? 'mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900'
                : 'mb-4 rounded-xl border border-indigo-300 bg-indigo-50 p-3 text-sm font-medium text-indigo-900'
          }
        >
          {mailNotice.text}
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
        pagination={paginateRows(filteredRows, page)}
        counts={countUnderFilters(rows, filters)}
        filters={filters}
        portals={portals}
        baseTotal={baseRows.length}
        warnings={warnings}
        documents={documents}
        catalog={catalog}
      />

      {(mailStatus.configured || modalRows.length > 0) && (
        <section aria-labelledby="mail-heading" className="mt-8">
          <h2 id="mail-heading" className="text-lg font-semibold text-slate-900">
            {ES.mail.status.heading}
          </h2>

          {mailStatus.configured && mailStatus.tokenStatus === 'expiring' && (
            <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
              {ES.mail.token.expiring}
            </p>
          )}
          {mailStatus.configured && mailStatus.tokenStatus === 'expired' && (
            <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
              {ES.mail.token.expired}
            </p>
          )}
          {mailStatus.stateCorrupt && (
            <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900">
              {ES.mail.run.state_corrupt}
            </p>
          )}

          {mailStatus.configured && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {lastCheck === null ? ES.mail.status.neverRan : ES.mail.status.lastCheck(lastCheck)}
              </p>
              <form action={checkMailNowAction}>
                <button
                  type="submit"
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  {ES.mail.labels.checkNow}
                </button>
              </form>
            </div>
          )}

          {modalRows.length > 0 && (
            <details className="mt-3 rounded-xl border border-slate-700 bg-slate-900">
              <summary className="cursor-pointer p-3 text-sm font-medium text-slate-100">
                {ES.mail.status.pending(modalRows.length)}
              </summary>
              <ul className="space-y-3 p-3 pt-0">
                {modalRows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-200">
                    <p className="font-medium">
                      {row.company}
                      {row.title.length > 0 ? ` — ${row.title}` : ''}
                    </p>
                    <p className="mt-1 text-slate-300">
                      {row.currentState === null ? null : (
                        <>
                          {ES.mail.modal.currentState}: {row.currentState} · {' '}
                        </>
                      )}
                      {ES.mail.modal.proposedState}: {row.proposedState}
                    </p>
                    {row.snippet.length > 0 && (
                      <p className="mt-1 italic text-slate-300">«{row.snippet}»</p>
                    )}
                    <div className="mt-2 flex gap-3">
                      <form action={acceptMailProposalAction}>
                        <input type="hidden" name="proposalId" value={row.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
                        >
                          {ES.mail.labels.accept}
                        </button>
                      </form>
                      <form action={dismissMailProposalAction}>
                        <input type="hidden" name="proposalId" value={row.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
                        >
                          {ES.mail.labels.dismiss}
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <MailCatchUp due={mailDue} />
      <MailProposalsModal rows={modalRows} />
    </main>
  );
}
