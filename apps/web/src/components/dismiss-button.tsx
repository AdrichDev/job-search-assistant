'use client';

import {
  DISMISSAL_REASONS,
  isDismissalReason,
  type DismissalReason,
} from '@job-queue/core/domain';
import { useState, useTransition } from 'react';
import { dismissOfferAction } from '@/app/actions';
import { ES, translateActionMessage } from '@/copy/es';

/**
 * The secondary action: "not interested in this one".
 *
 * ## Why it is quiet
 *
 * The accent colour belongs to Apply and to nothing else - that is the rule
 * `globals.css` states and the reason Apply is findable without reading the
 * card. So this is a ghost button: no fill, no accent, slate text, a border
 * that only appears on hover. It is unmistakably a control (a real `<button>`,
 * tab-focusable, with the app-wide `focus-visible` ring) and unmistakably not
 * the thing you came here to press.
 *
 * ## Why there is no confirmation dialog
 *
 * Confirmation is what you put in front of something irreversible. This is not:
 * the offer is hidden, not deleted, and one click in the collapsed "Ofertas
 * descartadas" section brings it back. A dialog here would train the human to
 * dismiss dialogs, which is exactly what you do not want on the day a real one
 * appears. The reversibility is stated in the helper text instead, where it
 * answers the question before it is asked.
 *
 * ## Why it is not styled as destructive
 *
 * No red, no trash can. Red says "you are about to lose something"; nothing is
 * lost here. Borrowing danger styling for a reversible preference would spend
 * the alarm vocabulary on a non-event.
 *
 * ## The applied conflict, shown rather than hidden
 *
 * An applied offer renders a disabled control that SAYS why, instead of the
 * button silently vanishing. A control that disappears looks like a bug; one
 * that explains itself teaches the rule. The server refuses independently -
 * see `dismiss-job.ts` - because a stale tab or a crafted request must not get
 * through a decision made in the browser.
 */

const BASE =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 ' +
  'text-xs font-medium transition duration-150 sm:w-auto motion-reduce:transition-none';

const AVAILABLE =
  'border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 ' +
  'active:bg-slate-100';

/**
 * `disabled` plus a written reason. `aria-disabled` alone would leave it
 * clickable; `disabled` alone would leave a screen reader with a dead control
 * and no explanation, so the label itself carries the fact.
 */
const BLOCKED = 'cursor-not-allowed border-transparent text-slate-400';

function CrossIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d="m6 6 8 8M14 6l-8 8" />
    </svg>
  );
}

export function DismissButton({
  jobId,
  title,
  applied,
}: {
  jobId: string;
  title: string;
  applied: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reason, setReason] = useState<DismissalReason | ''>('');

  if (applied) {
    return (
      <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
        <button type="button" disabled className={`${BASE} ${BLOCKED}`}>
          {ES.dismiss.blockedByApplication}
        </button>
        <p className="max-w-[15rem] text-xs leading-snug text-slate-500 sm:text-right">
          {ES.dismiss.blockedByApplicationTitle}
        </p>
      </div>
    );
  }

  function handleDismiss() {
    startTransition(async () => {
      const result = await dismissOfferAction(jobId, reason || undefined);
      // Kept on a successful dismiss too: `revalidatePath` re-renders the page
      // without this card, so the message is only ever read on the paths where
      // the card SURVIVES - which are exactly the ones worth explaining.
      setFeedback(translateActionMessage(result.message));
    });
  }

  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
      <label className="w-full text-xs text-slate-600 sm:w-56">
        <span className="sr-only">{ES.dismiss.reasonLabel}</span>
        <select
          value={reason}
          disabled={isPending}
          onChange={(event) => {
            const value = event.target.value;
            if (value === '' || isDismissalReason(value)) setReason(value);
          }}
          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700"
        >
          <option value="">{ES.dismiss.reasonPlaceholder}</option>
          {DISMISSAL_REASONS.map((option) => (
            <option key={option} value={option}>{ES.dismiss.reasonOptions[option]}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={isPending}
        className={`${BASE} ${AVAILABLE}`}
      >
        <CrossIcon />
        <span>{isPending ? ES.dismiss.pending : ES.dismiss.action}</span>
        <span className="sr-only">{ES.dismiss.screenReader(title)}</span>
      </button>

      {/* The reversibility, always visible. This is the sentence that replaces
          a confirmation dialog. */}
      <p className="max-w-[15rem] text-xs leading-snug text-slate-500 sm:text-right">
        {ES.dismiss.hint}
      </p>

      <p aria-live="polite" className="min-h-[1rem] text-xs font-medium text-slate-600 sm:text-right">
        {feedback ?? ''}
      </p>
    </div>
  );
}
