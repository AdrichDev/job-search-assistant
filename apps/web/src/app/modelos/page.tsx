import type { Metadata } from 'next';
import { ConfirmRemoval, ModelsTable, Notice, RegisterSection } from '@/components/cv-models-view';
import { isCvModelNoticeCode } from '@/copy/cv-model-notices';
import { ES } from '@/copy/es';
import { cvModelDeps } from '@/server/container';
import { loadModelsPage } from '@/server/cv-models';

/** The registry and the folder change outside the app; never serve a cached copy. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: ES.models.meta.title,
  description: ES.models.meta.description,
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  // Only codes from the closed set are ever printed; anything else in the URL is ignored.
  const aviso = single(query.aviso);
  const notice = isCvModelNoticeCode(aviso) ? aviso : null;
  const page = await loadModelsPage(cvModelDeps());
  const removing = page.models.find((entry) => entry.model.id === single(query.quitar))?.model;

  return (
    <main id="modelos" className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="mb-6">
        <h1 className="border-l-4 border-neon-lime pl-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          {ES.models.heading}
        </h1>
        <p className="prose-measure mt-2 text-sm leading-relaxed text-slate-600">{ES.models.intro}</p>
        <p className="mt-2 text-xs text-slate-500">{ES.models.total(page.models.length)}</p>
      </header>

      {notice !== null && <Notice code={notice} />}

      {page.warnings.length > 0 && (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">{ES.models.warningTitle}</p>
          <ul className="mt-1 list-inside list-disc">
            {page.warnings.map((code) => (
              <li key={code}>{ES.models.notices[code]}</li>
            ))}
          </ul>
        </div>
      )}

      {removing !== undefined && <ConfirmRemoval model={removing} />}

      <ModelsTable models={page.models} />
      <RegisterSection candidates={page.candidates} truncated={page.candidatesTruncated} />
    </main>
  );
}
