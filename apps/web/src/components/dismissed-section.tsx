'use client';

import { useState, useTransition } from 'react';
import type { DismissedRow } from '@job-queue/core/domain';
import { restoreOfferAction } from '@/app/actions';
import { Chip } from '@/components/chips';
import { ES, LOCALE, translateActionMessage } from '@/copy/es';

/**
 * The way back.
 *
 * Collapsed by default, and that is the whole design brief: a dismissal is a
 * decision the human already made, so re-presenting those offers at full size
 * would undo the point of dismissing them. But it has to EXIST and it has to
 * WORK, because a hide with no restore is a delete wearing a friendlier word.
 *
 * `<details>`/`<summary>` rather than a `useState` accordion: it is keyboard
 * operable, screen-reader announced and Ctrl+F-findable for free, and it works
 * with JavaScript disabled. Rebuilding that with a div and an `aria-expanded`
 * would be strictly worse in every one of those ways.
 *
 * Rendered only when there is something in it. An empty "0 descartadas" row on
 * every page is furniture that teaches the eye to skip that part of the screen.
 */

function UndoIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d="M4 9h9a4 4 0 0 1 0 8H8" />
      <path d="M7 6 4 9l3 3" />
    </svg>
  );
}

function RestoreRow({ row }: { row: DismissedRow }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreOfferAction(row.jobId);
      setFeedback(translateActionMessage(result.message));
    });
  }

  return (
    <li className="flex flex-col gap-2 border-t border-slate-200 py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-800">{row.title}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {row.company}
          {row.location !== null && (
            <>
              <span className="text-slate-400"> · </span>
              {row.location}
            </>
          )}
          <span className="text-slate-400"> · </span>
          {ES.dismissed.dismissedAt(new Date(row.dismissedAt).toLocaleDateString(LOCALE))}
        </p>

        {/*
          The dismissal outlived the posting. Said out loud rather than left as
          a mystery, because restoring it will not make it reappear today - and
          a human who restores something and sees nothing happen concludes the
          button is broken.
        */}
        {!row.inQueue && (
          <span className="mt-1.5 inline-block" title={ES.dismissed.goneFromQueueTitle}>
            <Chip tone="muted">{ES.dismissed.goneFromQueue}</Chip>
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
        <button
          type="button"
          onClick={handleRestore}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition duration-150 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 motion-reduce:transition-none"
        >
          <UndoIcon />
          <span>{isPending ? ES.dismissed.restorePending : ES.dismissed.restore}</span>
          <span className="sr-only">{ES.dismissed.restoreScreenReader(row.title)}</span>
        </button>
        <p aria-live="polite" className="min-h-[1rem] text-xs text-slate-600">
          {feedback ?? ''}
        </p>
      </div>
    </li>
  );
}

export function DismissedSection({ rows }: { rows: readonly DismissedRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="dismissed-heading" className="mt-8">
      <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary
          id="dismissed-heading"
          className="cursor-pointer rounded-xl px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {ES.dismissed.summary(rows.length)}
        </summary>

        <div className="border-t border-slate-200 px-4 pb-3">
          <p className="prose-measure mt-3 text-xs leading-relaxed text-slate-500">
            {ES.dismissed.intro}
          </p>
          <ul className="mt-2 flex flex-col">
            {rows.map((row) => (
              <RestoreRow key={row.jobId} row={row} />
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}
