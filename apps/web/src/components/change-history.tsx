import { revertChangeAction } from '@/app/actions';
import { describeChangeValue, formatHistoryDate, historyFieldLabel } from '@/components/history-format';
import { ES } from '@/copy/es';
import type { ApplicationHistoryData, HistoryEntryView, RevertNotice } from '@/server/history';
import { EMPTY_CATALOG, type ModelCatalog } from '@/server/model-catalog';

const NOTICE_TONE: Record<RevertNotice['tone'], string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

function Value({
  field,
  value,
  catalog,
}: {
  field: HistoryEntryView['changes'][number]['field'];
  value: Parameters<typeof describeChangeValue>[1];
  catalog: ModelCatalog;
}) {
  const shown = describeChangeValue(field, value, catalog);
  return <span className={shown.empty ? 'italic text-slate-500' : 'text-slate-900'}>{shown.text}</span>;
}

function Changes({ entry, catalog }: { entry: HistoryEntryView; catalog: ModelCatalog }) {
  if (entry.changes.length === 0) {
    return <p className="text-slate-600">{ES.history.noFieldChanges}</p>;
  }
  return (
    <ul className="space-y-1">
      {entry.changes.map((change) => (
        <li key={change.field}>
          <span className="font-medium text-slate-800">{historyFieldLabel(change.field)}:</span>{' '}
          <span className="sr-only">{ES.history.before} </span>
          <Value field={change.field} value={change.before} catalog={catalog} />{' '}
          <span aria-hidden="true">→</span>
          <span className="sr-only"> {ES.history.after} </span>{' '}
          <Value field={change.field} value={change.after} catalog={catalog} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The change history of one application: newest first, who/what made each change,
 * before -> after per field, and a Deshacer button on the entries that may be
 * undone. A plain table and plain form posts: keyboard-only usable, no client JS
 * needed. Long values are cut for display only (the history keeps them whole).
 */
export function ChangeHistory({
  data,
  notice,
  models = EMPTY_CATALOG,
}: {
  data: ApplicationHistoryData;
  notice: RevertNotice | null;
  /** The model registry, read once by the page; ids are shown as names. */
  models?: ModelCatalog;
}) {
  const byId = new Map(data.entries.map((entry) => [entry.id, entry]));
  const anyTruncated = data.entries.some((entry) =>
    entry.changes.some(
      (change) =>
        describeChangeValue(change.field, change.before, models).truncated === true ||
        describeChangeValue(change.field, change.after, models).truncated === true,
    ),
  );

  return (
    <section id="historial" aria-labelledby="historial-heading" className="mt-10 scroll-mt-4">
      <h2 id="historial-heading" className="text-xl font-semibold tracking-tight text-slate-900">
        {ES.history.heading}
      </h2>
      <p className="prose-measure mt-2 text-sm leading-relaxed text-slate-600">{ES.history.intro}</p>

      {notice !== null && (
        <p
          role="status"
          className={`mt-4 rounded-xl border p-3 text-sm font-medium ${NOTICE_TONE[notice.tone]}`}
        >
          {notice.text}
        </p>
      )}

      {data.warning !== null && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{ES.history.warningTitle}</p>
          <p className="mt-1 break-words">{ES.history.warning(data.warning)}</p>
        </div>
      )}

      {data.warning === null && data.entries.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-6">
          <h3 className="text-base font-semibold text-slate-900">{ES.history.emptyTitle}</h3>
          <p className="prose-measure mt-1 text-sm text-slate-600">{ES.history.emptyBody}</p>
        </div>
      )}

      {data.entries.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <caption className="sr-only">{ES.history.caption}</caption>
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">{ES.history.columns.date}</th>
                <th scope="col" className="px-3 py-2 font-semibold">{ES.history.columns.source}</th>
                <th scope="col" className="px-3 py-2 font-semibold">{ES.history.columns.changes}</th>
                <th scope="col" className="px-3 py-2 font-semibold">{ES.history.columns.action}</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => {
                const target = entry.revertsId === undefined ? undefined : byId.get(entry.revertsId);
                const date = formatHistoryDate(entry.at);
                return (
                  <tr key={entry.id} className="border-t border-slate-200 align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-800">{date}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">{ES.history.sources[entry.source]}</span>
                      {target !== undefined && (
                        <span className="mt-0.5 block text-xs text-slate-600">
                          {ES.history.revertsEntry(formatHistoryDate(target.at))}
                        </span>
                      )}
                      {entry.reverted && (
                        <span className="mt-1 inline-block rounded border border-slate-400 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                          {ES.history.reverted}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Changes entry={entry} catalog={models} />
                    </td>
                    <td className="px-3 py-2">
                      {entry.undoable ? (
                        <form action={revertChangeAction}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <button
                            type="submit"
                            aria-label={ES.history.undoHint(date)}
                            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-400 hover:bg-slate-100"
                          >
                            {ES.history.undo}
                          </button>
                        </form>
                      ) : (
                        <span aria-hidden="true" className="text-slate-400">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.entries.some((entry) => entry.undoable) && (
        <p className="mt-2 text-xs text-slate-600">{ES.history.undoDescription}</p>
      )}
      {anyTruncated && <p className="mt-1 text-xs text-slate-600">{ES.history.truncatedHint}</p>}
    </section>
  );
}
