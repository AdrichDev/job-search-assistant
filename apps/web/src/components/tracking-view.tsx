import Link from 'next/link';
import type { ApplicationOutcome, TrackedApplication } from '@job-queue/core';
import { APPLICATION_OUTCOMES, isResponse } from '@job-queue/core';
import { StatusChip } from '@/components/chips';
import { formatTrackingDate, trackingSourceLabels } from '@/components/tracking-format';
import { ES } from '@/copy/es';
import type { EstadoFilter, TrackingWarning } from '@/server/tracking';

const BASE_PATH = '/seguimiento';

function filterHref(filter: EstadoFilter): string {
  return filter === 'all' ? BASE_PATH : `${BASE_PATH}?estado=${filter}`;
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

function Row({ row }: { row: TrackedApplication }) {
  const sources = trackingSourceLabels(row);
  return (
    <tr className="align-top">
      <th scope="row" className="px-3 py-3 text-left font-medium text-slate-900">
        {row.company.length > 0 ? row.company : ES.tracking.noCompany}
      </th>
      <td className="px-3 py-3">
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
      </td>
      <td className="px-3 py-3">{sources.join(' · ')}</td>
      <td className="px-3 py-3">{row.city ?? ES.tracking.noCity}</td>
      <td className="whitespace-nowrap px-3 py-3">
        <time dateTime={row.appliedAt.toISOString()}>{formatTrackingDate(row.appliedAt)}</time>
      </td>
      <td className="px-3 py-3">
        <StatusChip status={row.outcome} />
      </td>
      <td className="whitespace-nowrap px-3 py-3">
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
      <td className="max-w-xs px-3 py-3 text-slate-700">
        {row.notes ?? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{ES.tracking.noNotes}</span>
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
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

/** Read-only table of every application, with a server-side outcome filter. */
export function TrackingView({
  rows,
  visibleRows,
  counts,
  filter,
  warnings,
}: {
  rows: readonly TrackedApplication[];
  visibleRows: readonly TrackedApplication[];
  counts: Readonly<Record<ApplicationOutcome, number>>;
  filter: EstadoFilter;
  warnings: readonly TrackingWarning[];
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
            {ES.tracking.showing(visibleRows.length, rows.length)}
          </p>

          {visibleRows.length === 0 ? (
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
              className="overflow-x-auto rounded-xl border border-slate-200 bg-white"
            >
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">{ES.tracking.caption}</caption>
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th scope="col" className="px-3 py-2">{columns.company}</th>
                    <th scope="col" className="px-3 py-2">{columns.title}</th>
                    <th scope="col" className="px-3 py-2">{columns.source}</th>
                    <th scope="col" className="px-3 py-2">{columns.city}</th>
                    <th scope="col" className="px-3 py-2">{columns.appliedAt}</th>
                    <th scope="col" className="px-3 py-2">{columns.status}</th>
                    <th scope="col" className="px-3 py-2">{columns.respondedAt}</th>
                    <th scope="col" className="px-3 py-2">{columns.notes}</th>
                    <th scope="col" className="px-3 py-2">{columns.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.map((row) => (
                    <Row key={row.jobId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
