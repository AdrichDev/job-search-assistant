import { ES } from '@/copy/es';

/**
 * What the user sees when there is nothing to show.
 *
 * This state is not a decorative afterthought here - it is the state the app
 * was actually left in when every source query returned HTTP 429. An empty
 * screen that says nothing turns a recoverable API outage into "the app is
 * broken", so this says which of the two happened and what to do next.
 *
 * The two cases are kept distinct on purpose:
 *
 * - `degraded`: the sources failed. Nothing was learned, and the previous data
 *   was NOT overwritten. Actionable: wait and re-run, or restore the seed.
 * - empty: the sources worked and genuinely returned nothing worth showing.
 *   Different fact, different remedy, so it must not borrow the alarm.
 */
export function EmptyQueue({ degraded }: { degraded: boolean }) {
  return (
    <div
      className={`rounded-xl border p-6 sm:p-8 ${
        degraded ? 'border-amber-300 bg-amber-50' : 'border-dashed border-slate-300 bg-white'
      }`}
    >
      <h3
        className={`text-base font-semibold ${degraded ? 'text-amber-900' : 'text-slate-900'}`}
      >
        {degraded ? ES.emptyQueue.headingDegraded : ES.emptyQueue.headingEmpty}
      </h3>

      <p
        className={`prose-measure mt-2 text-sm leading-relaxed ${
          degraded ? 'text-amber-900' : 'text-slate-600'
        }`}
      >
        {degraded ? ES.emptyQueue.bodyDegraded : ES.emptyQueue.bodyEmpty}
      </p>

      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {ES.emptyQueue.whatToDo}
      </p>

      <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
        <li className="flex gap-2">
          <span aria-hidden="true" className="text-slate-400">
            •
          </span>
          {ES.emptyQueue.stepRerun}
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="text-slate-400">
            •
          </span>
          {ES.emptyQueue.stepBoards}
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true" className="text-slate-400">
            •
          </span>
          {ES.emptyQueue.stepOffline}
        </li>
      </ul>
    </div>
  );
}
