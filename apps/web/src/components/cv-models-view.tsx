import Link from 'next/link';
import type { ListedCvModel } from '@job-queue/core';
import { registerCvModelAction, removeCvModelAction } from '@/app/actions';
import { ModelFields } from '@/components/cv-model-fields';
import { isCvModelSuccessCode, type CvModelNoticeCode } from '@/copy/cv-model-notices';
import { ES } from '@/copy/es';
import { suggestModelName, suggestTags } from '@/server/cv-models';

export function Notice({ code }: { code: CvModelNoticeCode }) {
  const success = isCvModelSuccessCode(code);
  return (
    <p
      role={success ? 'status' : 'alert'}
      className={
        success
          ? 'mb-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900'
          : 'mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900'
      }
    >
      {success ? '' : `${ES.models.problemTitle}. `}
      {ES.models.notices[code]}
    </p>
  );
}

function Row({ entry }: { entry: ListedCvModel }) {
  const { model, available } = entry;
  const id = encodeURIComponent(model.id);
  const action = 'text-sm font-medium text-indigo-700 underline';

  return (
    <tr className="align-top">
      <th scope="row" className="px-3 py-3 text-left font-medium text-slate-900">
        {model.name}
        {model.note !== undefined && (
          <span className="mt-1 block whitespace-pre-line text-xs font-normal text-slate-600">
            {model.note}
          </span>
        )}
      </th>
      <td className="px-3 py-3">{ES.models.kinds[model.kind]}</td>
      <td className="px-3 py-3">{ES.models.languages[model.language]}</td>
      <td className="px-3 py-3">
        {model.tags.length === 0 ? (
          <span className="text-slate-500">{ES.models.noTags}</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {model.tags.map((tag) => (
              <li key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-3">
        {available ? (
          <span className="font-medium text-emerald-800">{ES.models.available}</span>
        ) : (
          <>
            <span className="font-medium text-amber-900">{ES.models.unavailable}</span>
            <span className="mt-1 block text-xs text-slate-600">{ES.models.unavailableHint}</span>
          </>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {available && (
            <a
              href={`/modelos/${id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className={action}
            >
              {ES.models.open}
              <span className="sr-only"> {ES.models.openHint(model.name)}</span>
            </a>
          )}
          <Link href={`/modelos/${id}/editar`} className={action}>
            {ES.models.edit}
            <span className="sr-only"> {ES.models.editHint(model.name)}</span>
          </Link>
          <Link href={`/modelos?quitar=${id}#confirmar-quitar`} className={action}>
            {ES.models.remove}
            <span className="sr-only"> {ES.models.removeHint(model.name)}</span>
          </Link>
        </div>
      </td>
    </tr>
  );
}

/** Confirmation step of a removal: a plain page section, no JavaScript needed. */
export function ConfirmRemoval({ model }: { model: ListedCvModel['model'] }) {
  return (
    <section
      id="confirmar-quitar"
      aria-labelledby="confirmar-quitar-titulo"
      className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h2 id="confirmar-quitar-titulo" className="text-base font-semibold text-amber-950">
        {ES.models.confirm.heading}
      </h2>
      <p className="prose-measure mt-1 text-sm text-amber-950">{ES.models.confirm.body(model.name)}</p>
      <form action={removeCvModelAction} className="mt-3 flex flex-wrap gap-3">
        <input type="hidden" name="id" value={model.id} />
        <button
          type="submit"
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
        >
          {ES.models.confirm.yes}
        </button>
        <Link
          href="/modelos"
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
        >
          {ES.models.confirm.cancel}
        </Link>
      </form>
    </section>
  );
}

export function ModelsTable({ models }: { models: readonly ListedCvModel[] }) {
  const columns = ES.models.columns;
  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 sm:p-8">
        <h2 className="text-base font-semibold text-slate-900">{ES.models.emptyTitle}</h2>
        <p className="prose-measure mt-2 text-sm text-slate-600">{ES.models.emptyBody}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">{ES.models.caption}</caption>
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>
            <th scope="col" className="px-3 py-2">{columns.name}</th>
            <th scope="col" className="px-3 py-2">{columns.kind}</th>
            <th scope="col" className="px-3 py-2">{columns.language}</th>
            <th scope="col" className="px-3 py-2">{columns.tags}</th>
            <th scope="col" className="px-3 py-2">{columns.status}</th>
            <th scope="col" className="px-3 py-2">{columns.actions}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {models.map((entry) => (
            <Row key={entry.model.id} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One collapsed form per unregistered PDF: native `<details>`, keyboard-usable without JS. */
export function RegisterSection({
  candidates,
  truncated,
}: {
  candidates: readonly string[];
  truncated: boolean;
}) {
  return (
    <section id="registrar" aria-labelledby="registrar-titulo" className="mt-10">
      <h2 id="registrar-titulo" className="text-xl font-semibold text-slate-900">
        {ES.models.register.heading}
      </h2>
      <p className="prose-measure mt-1 text-sm text-slate-600">{ES.models.register.intro}</p>
      {truncated && <p className="mt-2 text-sm text-amber-900">{ES.models.register.truncated}</p>}

      {candidates.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
          {ES.models.register.none}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {candidates.map((path, index) => (
            <li key={path}>
              <details className="rounded-xl border border-slate-200 bg-white p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-900">
                  {ES.models.register.pick(path)}
                </summary>
                <form action={registerCvModelAction} className="mt-4 space-y-4">
                  <input type="hidden" name="relativePath" value={path} />
                  <ModelFields
                    prefix={`reg-${index}`}
                    values={{
                      name: suggestModelName(path),
                      kind: 'cv',
                      language: 'es',
                      tags: suggestTags(path).join(', '),
                      note: '',
                    }}
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    {ES.models.register.submit}
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
