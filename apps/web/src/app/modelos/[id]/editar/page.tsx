import type { Metadata } from 'next';
import Link from 'next/link';
import { updateCvModelAction } from '@/app/actions';
import { ModelFields } from '@/components/cv-model-fields';
import { Notice } from '@/components/cv-models-view';
import { isCvModelNoticeCode } from '@/copy/cv-model-notices';
import { ES } from '@/copy/es';
import { cvModelRepository } from '@/server/container';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: ES.models.editPage.meta.title };

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function EditModelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const aviso = single((await searchParams).aviso);
  const notice = isCvModelNoticeCode(aviso) ? aviso : null;

  // The id is a registry key only. A failing registry gets its own sentence;
  // the technical detail stays in the server log.
  let model = null;
  let registryProblem = false;
  try {
    model = id.length <= 200 ? await cvModelRepository().find(id) : null;
  } catch (cause) {
    registryProblem = true;
    console.error(
      `CV model edit page: registry unreadable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  return (
    <main id="modelos" className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-3 text-sm">
        <Link href="/modelos" className="font-medium text-indigo-700 underline">
          {ES.models.editPage.back}
        </Link>
      </p>

      {model === null ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{ES.models.editPage.notFoundTitle}</h1>
          <p className="prose-measure mt-2 text-sm text-slate-600">
            {registryProblem
              ? ES.models.notices.registry_unavailable
              : ES.models.editPage.notFoundBody}
          </p>
        </div>
      ) : (
        <>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {ES.models.editPage.heading}
            </h1>
          </header>
          {notice !== null && <Notice code={notice} />}
          <form action={updateCvModelAction} className="space-y-5">
            <input type="hidden" name="id" value={model.id} />
            <p className="text-sm text-slate-700">
              <span className="font-medium">{ES.models.fields.path}:</span> {model.relativePath}
              <span className="mt-1 block text-xs text-slate-500">{ES.models.hints.path}</span>
            </p>
            <ModelFields
              prefix="edit"
              values={{
                name: model.name,
                kind: model.kind,
                language: model.language,
                tags: model.tags.join(', '),
                note: model.note ?? '',
              }}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                {ES.models.editPage.submit}
              </button>
              <Link
                href="/modelos"
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-100"
              >
                {ES.models.confirm.cancel}
              </Link>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
