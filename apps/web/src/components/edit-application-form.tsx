'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { submitEditApplicationForm, type EditFormState } from '@/app/actions';
import { ES, translateActionMessage } from '@/copy/es';
import type { EditFormValues } from '@/server/edit-form';
import type { ModelSelect } from '@/server/model-catalog';

const INITIAL: EditFormState = { message: null, values: null, attempt: 0 };

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 hover:border-slate-400';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * One form with every editable field of an application, pre-filled with the
 * current values. A refused edit comes back with what the person typed, so
 * nothing is lost; a successful one leaves for the tracking view.
 *
 * A plain `<form>` posting to a server action: real labels, an explicit submit
 * button, and it keeps working without client JavaScript.
 */
export function EditApplicationForm({
  initial,
  outcomes,
  cvVariants,
  hasListing,
  cvModels,
  letterModels,
}: {
  initial: EditFormValues;
  outcomes: readonly string[];
  cvVariants: readonly string[];
  hasListing: boolean;
  /** Options of the model selects, built on the server from the registry. */
  cvModels: ModelSelect;
  letterModels: ModelSelect;
}) {
  const [state, formAction] = useActionState(submitEditApplicationForm, INITIAL);
  const values: EditFormValues = { ...initial, ...(state.values ?? {}) };
  /*
   * The inputs are uncontrolled (`defaultValue`), so React ignores a new default
   * on a form that stays mounted. That happens when an undo redirects back to this
   * very page with the restored values: without a key that changes with the stored
   * values the form would keep showing (and saving back) the pre-undo text.
   */
  const f = ES.edit.fields;

  const text = (name: keyof EditFormValues, label: string, hint?: string, type = 'text') => (
    <Field id={`edit-${name}`} label={label} {...(hint === undefined ? {} : { hint })}>
      <input
        id={`edit-${name}`}
        name={name}
        type={type}
        defaultValue={values[name]}
        {...(hint === undefined ? {} : { 'aria-describedby': `edit-${name}-hint` })}
        className={INPUT}
      />
    </Field>
  );

  const modelField = (name: 'cvModelId' | 'letterModelId', label: string, select: ModelSelect) => {
    const hint = select.unavailable
      ? f.modelsUnavailableHint
      : select.empty
        ? f.noModelsHint
        : undefined;
    return (
      <Field id={`edit-${name}`} label={label}>
        <select
          id={`edit-${name}`}
          name={name}
          defaultValue={values[name]}
          disabled={select.disabled}
          {...(hint === undefined ? {} : { 'aria-describedby': `edit-${name}-hint` })}
          className={`${INPUT} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
        >
          {select.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {hint !== undefined && (
          <p id={`edit-${name}-hint`} className="text-xs text-slate-600">
            {hint}{' '}
            <Link href="/modelos" className="font-medium text-indigo-700 underline">
              {f.noModelsLink}
            </Link>
          </p>
        )}
      </Field>
    );
  };

  return (
    <form key={`${state.attempt}:${JSON.stringify(initial)}`} action={formAction} className="space-y-5">
      <input type="hidden" name="jobId" value={values.jobId} />

      {state.message !== null && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900"
        >
          <p className="font-semibold">{ES.edit.errorTitle}</p>
          <p className="mt-1">{translateActionMessage(state.message)}</p>
        </div>
      )}

      {!hasListing && (
        <p role="note" className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          {ES.edit.hints.noListing}
        </p>
      )}

      <Group legend={ES.edit.groups.state}>
        <Field id="edit-outcome" label={f.outcome}>
          <select id="edit-outcome" name="outcome" defaultValue={values.outcome} className={INPUT}>
            {outcomes.map((outcome) => (
              <option key={outcome} value={outcome}>
                {ES.outcomeOption[outcome as keyof typeof ES.outcomeOption] ?? outcome}
              </option>
            ))}
          </select>
        </Field>
        {text('outcomeUpdatedAt', f.outcomeUpdatedAt, ES.edit.hints.outcomeDate, 'date')}
        {text('appliedAt', f.appliedAt, undefined, 'date')}
        <Field id="edit-cvVariant" label={f.cvVariant}>
          <select id="edit-cvVariant" name="cvVariant" defaultValue={values.cvVariant} className={INPUT}>
            <option value="">{f.noCv}</option>
            {cvVariants.map((variant) => (
              <option key={variant} value={variant}>
                {ES.cvVariant[variant as keyof typeof ES.cvVariant] ?? variant}
              </option>
            ))}
          </select>
        </Field>
        {modelField('cvModelId', f.cvModel, cvModels)}
        {modelField('letterModelId', f.letterModel, letterModels)}
        <div className="sm:col-span-2">
          <Field id="edit-notes" label={f.notes}>
            <textarea
              id="edit-notes"
              name="notes"
              rows={4}
              defaultValue={values.notes}
              className={INPUT}
            />
          </Field>
        </div>
      </Group>

      <Group legend={ES.edit.groups.offer}>
        {text('company', f.company, ES.edit.hints.company)}
        {text('title', f.title, ES.edit.hints.title)}
        {text('url', f.url, ES.edit.hints.url)}
        {text('portal', f.portal)}
        {text('city', f.city)}
        {text('publishedAt', f.publishedAt, undefined, 'date')}
      </Group>

      <Group legend={ES.edit.groups.contact}>
        {text('contact', f.contact)}
        {text('phone', f.phone)}
        {text('address', f.address)}
        {text('companyInfo', f.companyInfo)}
      </Group>

      <Group legend={ES.edit.groups.application}>
        <div className="sm:col-span-2">{text('sourceIds', f.sourceIds)}</div>
      </Group>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          {ES.edit.submit}
        </button>
        <Link
          href="/seguimiento"
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
        >
          {ES.edit.cancel}
        </Link>
      </div>
    </form>
  );
}
