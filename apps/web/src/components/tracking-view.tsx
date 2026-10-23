import Link from 'next/link';
import type { ApplicationOutcome, TrackedApplication } from '@job-queue/core';
import { APPLICATION_OUTCOMES } from '@job-queue/core';
import { isResponse } from '@job-queue/core';
import { describeDocuments, type DocumentRefsView } from '@/components/documents-format';
import { formatTrackingDate, trackingSourceLabels } from '@/components/tracking-format';
import {
  ESTADO_HEADER_CLASS,
  RESPONDED_HEADER_CLASS,
  estadoCellStyle,
  replyCellStyle,
} from '@/components/tracking-status';
import { ES } from '@/copy/es';
import { EMPTY_CATALOG, type ModelCatalog } from '@/server/model-catalog';
import type { EstadoFilter, PaginatedRows, TrackingWarning } from '@/server/tracking';

const BASE_PATH = '/seguimiento';

function filterHref(filter: EstadoFilter): string {
  return filter === 'all' ? BASE_PATH : `${BASE_PATH}?estado=${filter}`;
}

/** Pagination links keep the active filter; a filter link never carries `pagina`. */
function paginationHref(page: number, filter: EstadoFilter): string {
  const params = new URLSearchParams();
  if (filter !== 'all') {
    params.set('estado', filter);
  }
  params.set('pagina', String(page));
  return `${BASE_PATH}?${params.toString()}`;
}

function FilterLinks({
  active,
  counts,
  total,
}: {
  active: EstadoFilter;
  counts: Readonly<Record<ApplicationOutcome, number>>;
  total: number;
}) {
  const items: { filter: EstadoFilter; text: string }[] = [
    { filter: 'all', text: ES.tracking.filter.option(ES.tracking.filter.all, total) },
    ...APPLICATION_OUTCOMES.map((outcome) => ({
      filter: outcome as EstadoFilter,
      text: ES.tracking.filter.option(ES.status[outcome], counts[outcome]),
    })),
  ];

  return (
    <nav aria-label={ES.tracking.filter.label} className="mb-4">
      <ul className="flex flex-wrap gap-2">
        {items.map(({ filter, text }) => (
          <li key={filter}>
            <Link
              href={filterHref(filter)}
              {...(filter === active ? { 'aria-current': 'true' as const } : {})}
              className="inline-flex rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100 aria-[current=true]:bg-slate-900 aria-[current=true]:text-white aria-[current=true]:ring-slate-900"
            >
              {text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One pagination step: a real link when available, an inert mark when not. */
function PaginationEdge({
  available,
  href,
  label,
}: {
  available: boolean;
  href: string;
  label: string;
}) {
  if (!available) {
    return (
      <span aria-disabled="true" className="rounded-md px-2 py-1 text-slate-500">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-md px-2 py-1 font-medium text-slate-700 underline hover:bg-slate-100"
    >
      {label}
    </Link>
  );
}

/** Hidden entirely on a single page: there is nothing to paginate through. */
function PaginationNav({
  page,
  totalPages,
  filter,
}: {
  page: number;
  totalPages: number;
  filter: EstadoFilter;
}) {
  if (totalPages <= 1) {
    return null;
  }
  return (
    <nav
      aria-label={ES.tracking.pagination.label}
      className="mt-4 flex flex-wrap items-center justify-center gap-1 text-sm"
    >
      <PaginationEdge available={page > 1} href={paginationHref(1, filter)} label={ES.tracking.pagination.first} />
      <PaginationEdge available={page > 1} href={paginationHref(page - 1, filter)} label={ES.tracking.pagination.prev} />
      <span className="px-2 font-medium text-slate-700">
        {ES.tracking.pagination.page(page, totalPages)}
      </span>
      <PaginationEdge
        available={page < totalPages}
        href={paginationHref(page + 1, filter)}
        label={ES.tracking.pagination.next}
      />
      <PaginationEdge
        available={page < totalPages}
        href={paginationHref(totalPages, filter)}
        label={ES.tracking.pagination.last}
      />
    </nav>
  );
}

function Row({
  row,
  zebra,
  documents,
  catalog,
}: {
  row: TrackedApplication;
  zebra: boolean;
  documents: DocumentRefsView | undefined;
  catalog: ModelCatalog;
}) {
  const sources = trackingSourceLabels(row);
  const lines = describeDocuments(documents, catalog);
  const estado = estadoCellStyle(row.outcome);
  const reply = replyCellStyle(row.outcome);
  return (
    <tr className={`align-top${zebra ? ' bg-slate-100' : ''}`}>
      <th scope="row" className="px-3 py-1.5 text-left font-medium text-slate-900">
        {row.company.length > 0 ? row.company : ES.tracking.noCompany}
      </th>
      <td className="max-w-sm px-3 py-1.5">
        <p>{row.title}</p>
        {row.url !== undefined && (
          <a
            href={row.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs font-medium text-indigo-700 underline"
          >
            {ES.tracking.openOffer}
            <span className="sr-only"> {ES.tracking.openOfferHint(row.title, row.company)}</span>
          </a>
        )}
        {(row.companyInfo !== undefined || row.publishedAt !== undefined) && (
          <details className="mt-2 max-w-md text-xs">
            {/* A date-only detail is not labelled as company info: it has none. */}
            <summary className="cursor-pointer font-medium text-indigo-700">
              {row.companyInfo !== undefined
                ? ES.tracking.companyInfo.summary
                : ES.tracking.companyInfo.publishedAt}
            </summary>
            {row.companyInfo !== undefined && (
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{row.companyInfo}</p>
            )}
            {row.publishedAt !== undefined && (
              <p className="mt-1 text-slate-600">
                {row.companyInfo !== undefined && (
                  <>
                    <span className="font-medium">{ES.tracking.companyInfo.publishedAt}:</span>{' '}
                  </>
                )}
                <time dateTime={row.publishedAt.toISOString()}>{formatTrackingDate(row.publishedAt)}</time>
              </p>
            )}
          </details>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">{sources.join(' · ')}</td>
      <td className="px-3 py-1.5">{row.city ?? ES.tracking.noCity}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <time dateTime={row.appliedAt.toISOString()}>{formatTrackingDate(row.appliedAt)}</time>
      </td>
      {/* Spreadsheet cell: the word stays, the colour only reinforces it. */}
      <td className={`whitespace-nowrap px-3 py-1.5 ${estado.className}`}>{estado.label}</td>
      <td className={`whitespace-nowrap px-3 py-1.5 ${reply.className}`}>{reply.label}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {isResponse(row.outcome) ? (
          <time dateTime={row.outcomeUpdatedAt.toISOString()}>
            {formatTrackingDate(row.outcomeUpdatedAt)}
          </time>
        ) : (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{ES.tracking.noResponseDate}</span>
          </>
        )}
      </td>
      <td className="px-3 py-1.5 text-slate-700">
        {lines.length === 0 ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{ES.tracking.documents.none}</span>
          </>
        ) : (
          <ul className="space-y-0.5">
            {lines.map((line) => (
              <li key={line.label}>
                <span className="text-xs font-medium text-slate-500">{line.label}:</span>{' '}
                <span
                  className={
                    line.tone === 'warning'
                      ? 'italic text-amber-800'
                      : line.tone === 'legacy'
                        ? 'text-slate-600'
                        : 'text-slate-900'
                  }
                >
                  {line.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="max-w-xs px-3 py-1.5 text-slate-700">
        {row.notes ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{ES.tracking.noNotes}</span>
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <Link
          href={`${BASE_PATH}/${encodeURIComponent(row.jobId)}/editar`}
          aria-label={ES.tracking.editHint(row.company, row.title)}
          className="text-sm font-medium text-indigo-700 underline"
        >
          {ES.tracking.edit}
        </Link>
      </td>
    </tr>
  );
}

/** Read-only table of every application, filtered and paginated server-side. */
export function TrackingView({
  rows,
  pagination,
  counts,
  filter,
  warnings,
  documents,
  catalog = EMPTY_CATALOG,
}: {
  rows: readonly TrackedApplication[];
  pagination: PaginatedRows;
  counts: Readonly<Record<ApplicationOutcome, number>>;
  filter: EstadoFilter;
  warnings: readonly TrackingWarning[];
  /** Documents used per job id; resolved to names through `catalog` (read once by the page). */
  documents?: ReadonlyMap<string, DocumentRefsView>;
  catalog?: ModelCatalog;
}) {
  const logUnreadable = warnings.some((warning) => warning.kind === 'applications');
  const columns = ES.tracking.columns;

  return (
    <>
      {warnings.length > 0 && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">{ES.tracking.warningTitle}</p>
          <ul className="mt-1 list-inside list-disc">
            {warnings.map((warning) => (
              <li key={warning.kind}>{ES.tracking.warning[warning.kind](warning.detail)}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        !logUnreadable && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 sm:p-8">
            <h2 className="text-base font-semibold text-slate-900">{ES.tracking.emptyAllTitle}</h2>
            <p className="prose-measure mt-2 text-sm text-slate-600">{ES.tracking.emptyAllBody}</p>
          </div>
        )
      ) : (
        <>
          <FilterLinks active={filter} counts={counts} total={rows.length} />
          <p className="mb-3 text-sm text-slate-600" aria-live="polite">
            {ES.tracking.showingRange(pagination.from, pagination.to, pagination.total)}
          </p>

          {pagination.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 sm:p-8">
              <h2 className="text-base font-semibold text-slate-900">
                {ES.tracking.emptyFilterTitle(filter === 'all' ? '' : ES.status[filter])}
              </h2>
              <p className="prose-measure mt-2 text-sm text-slate-600">{ES.tracking.emptyFilterBody}</p>
              <Link href={BASE_PATH} className="mt-3 inline-block text-sm font-medium text-indigo-700 underline">
                {ES.tracking.emptyFilterAction}
              </Link>
            </div>
          ) : (
            <div
              role="region"
              aria-label={ES.tracking.scrollRegion}
              tabIndex={0}
              className="max-h-[80vh] overflow-auto rounded-xl border border-slate-200 bg-white"
            >
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">{ES.tracking.caption}</caption>
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    {(
                      [
                        { label: columns.company },
                        { label: columns.title },
                        { label: columns.source },
                        { label: columns.city },
                        { label: columns.appliedAt },
                        // The two spreadsheet columns keep their colour in the heading.
                        { label: columns.status, headerClass: ESTADO_HEADER_CLASS },
                        { label: columns.responded, headerClass: RESPONDED_HEADER_CLASS },
                        { label: columns.respondedAt },
                        { label: columns.documents },
                        { label: columns.notes },
                        { label: columns.actions },
                      ] as const
                    ).map((column) => (
                      <th
                        key={column.label}
                        scope="col"
                        className={`sticky top-0 z-10 px-3 py-1.5 ${'headerClass' in column ? column.headerClass : 'bg-slate-50'}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagination.rows.map((row, index) => (
                    <Row
                      key={row.jobId}
                      row={row}
                      zebra={index % 2 === 1}
                      documents={documents?.get(row.jobId)}
                      catalog={catalog}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <PaginationNav page={pagination.page} totalPages={pagination.totalPages} filter={filter} />
        </>
      )}
    </>
  );
}
