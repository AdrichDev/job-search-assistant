import type { Metadata } from 'next';
import Link from 'next/link';
import { APPLICATION_OUTCOMES } from '@job-queue/core';
import { ChangeHistory } from '@/components/change-history';
import { EditApplicationForm } from '@/components/edit-application-form';
import { ES } from '@/copy/es';
import {
  applicationHistoryRepository,
  applicationRepository,
  queueReader,
} from '@/server/container';
import { loadApplicationHistory, revertNoticeFor } from '@/server/history';
import { buildEditFormValues } from '@/server/edit-form';
import { decodeJobIdParam, loadEditableApplication } from '@/server/tracking';

/** Always read the current log: the form must show what is stored right now. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: ES.edit.meta.title,
};

export default async function EditApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Job ids contain `::` and spaces, so they travel percent-encoded.
  const jobId = decodeJobIdParam((await params).jobId);
  const found = await loadEditableApplication(jobId, {
    applicationRepository: applicationRepository(),
    queueReader: queueReader(),
  });
  const history =
    found === null
      ? null
      : await loadApplicationHistory(found.application.jobId, {
          historyRepository: applicationHistoryRepository(),
        });
  const notice = revertNoticeFor((await searchParams).deshacer);

  return (
    <main id="seguimiento" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-3 text-sm">
        <Link href="/seguimiento" className="font-medium text-indigo-700 underline">
          {ES.edit.back}
        </Link>
      </p>

      {found === null ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 sm:p-8">
          <h1 className="text-xl font-semibold text-slate-900">{ES.edit.notFoundTitle}</h1>
          <p className="prose-measure mt-2 text-sm text-slate-600">{ES.edit.notFoundBody}</p>
        </div>
      ) : (
        <>
          <header className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              {ES.edit.heading}
            </h1>
            <p className="prose-measure mt-2 text-sm leading-relaxed text-slate-600">
              {ES.edit.intro}
            </p>
          </header>
          <EditApplicationForm
            initial={buildEditFormValues(found.application, found.row)}
            outcomes={APPLICATION_OUTCOMES}
            cvVariants={Object.keys(ES.cvVariant)}
            hasListing={found.application.listing !== undefined}
          />
          {history !== null && <ChangeHistory data={history} notice={notice} />}
        </>
      )}
    </main>
  );
}
