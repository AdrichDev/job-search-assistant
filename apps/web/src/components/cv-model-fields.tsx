import { CV_MODEL_KINDS, CV_MODEL_LANGUAGES } from '@job-queue/core';
import { ES } from '@/copy/es';

const INPUT =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 hover:border-slate-400';

export interface ModelFieldValues {
  readonly name: string;
  readonly kind: string;
  readonly language: string;
  readonly tags: string;
  readonly note: string;
}

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

/**
 * The five editable fields of a model, shared by the registration form and the
 * edit page. `prefix` keeps ids unique when several forms share a page. The
 * file path is deliberately NOT a field here: it is chosen once, never edited.
 */
export function ModelFields({ prefix, values }: { prefix: string; values: ModelFieldValues }) {
  const f = ES.models.fields;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field id={`${prefix}-name`} label={f.name}>
          <input
            id={`${prefix}-name`}
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={values.name}
            className={INPUT}
          />
        </Field>
      </div>
      <Field id={`${prefix}-kind`} label={f.kind}>
        <select id={`${prefix}-kind`} name="kind" defaultValue={values.kind} className={INPUT}>
          {CV_MODEL_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {ES.models.kinds[kind]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${prefix}-language`} label={f.language}>
        <select
          id={`${prefix}-language`}
          name="language"
          defaultValue={values.language}
          className={INPUT}
        >
          {CV_MODEL_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {ES.models.languages[language]}
            </option>
          ))}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field id={`${prefix}-tags`} label={f.tags} hint={ES.models.hints.tags}>
          <input
            id={`${prefix}-tags`}
            name="tags"
            type="text"
            defaultValue={values.tags}
            aria-describedby={`${prefix}-tags-hint`}
            className={INPUT}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field id={`${prefix}-note`} label={f.note}>
          <textarea
            id={`${prefix}-note`}
            name="note"
            rows={3}
            maxLength={500}
            defaultValue={values.note}
            className={INPUT}
          />
        </Field>
      </div>
    </div>
  );
}
