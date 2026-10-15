import { APPLICATION_OUTCOMES, type QueueApplicationStatus } from '@job-queue/core/domain';
import { setOutcomeAction } from '@/app/actions';
import { ES } from '@/copy/es';

/**
 * Records what came back.
 *
 * A plain `<form>` posting to a server action: it works with JavaScript
 * disabled, every control is a real labelled form element, and there is an
 * explicit submit button rather than a surprise auto-submit on change.
 *
 * Wrapped in a `<fieldset>` with a `<legend>`: the three controls are one unit
 * of meaning, and a screen reader should announce that before reading them.
 */
export function OutcomeForm({
  jobId,
  status,
  notes,
}: {
  jobId: string;
  status: QueueApplicationStatus;
  notes: string | null;
}) {
  if (status === 'not_applied') {
    return null;
  }

  const selectId = `outcome-${jobId}`;
  const notesId = `notes-${jobId}`;

  return (
    <form action={setOutcomeAction} className="mt-4">
      <input type="hidden" name="jobId" value={jobId} />

      <fieldset className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {ES.outcome.legend}
        </legend>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={selectId} className="text-xs font-medium text-slate-600">
              {ES.outcome.label}
            </label>
            <select
              id={selectId}
              name="outcome"
              defaultValue={status}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 transition hover:border-slate-400 motion-reduce:transition-none"
            >
              {APPLICATION_OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {ES.outcomeOption[outcome]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor={notesId} className="text-xs font-medium text-slate-600">
              {ES.outcome.notesLabel}
            </label>
            <input
              id={notesId}
              name="notes"
              type="text"
              defaultValue={notes ?? ''}
              placeholder={ES.outcome.notesPlaceholder}
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 transition placeholder:text-slate-400 hover:border-slate-400 motion-reduce:transition-none"
            />
          </div>

          {/*
            Secondary by design. This is a bookkeeping action; making it compete
            with Apply would blunt the one control that matters.
          */}
          <button
            type="submit"
            className="rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-100 hover:ring-slate-400 active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0"
          >
            {ES.outcome.submit}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
