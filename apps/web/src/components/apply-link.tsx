'use client';

import { useState, useTransition } from 'react';
import { applyToJobAction } from '@/app/actions';
import { ES, translateActionMessage } from '@/copy/es';

/**
 * The primary action of the whole interface: one click must do two things.
 *
 * 1. Open the real posting in a new tab. This is a genuine `<a href>`, not a
 *    button pretending to be one - the human applies on the job board
 *    themselves. There is NO automation of any job board here, deliberately.
 * 2. Record the application server-side.
 *
 * `target="_blank"` is what makes both possible: the new tab handles the
 * navigation while this page stays alive to finish the server action.
 *
 * Progressive enhancement: with JavaScript disabled the anchor still opens the
 * posting, it simply does not log anything. The link never breaks.
 *
 * Idempotency is enforced server-side by the repository, not by disabling the
 * control - a disabled link would also stop the human re-opening the posting.
 *
 * The dual nature is stated in words underneath the button rather than implied,
 * because "this also writes to my history" is not something a user should have
 * to infer from a click.
 */

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none"
    >
      <path d="M7 13 13 7" />
      <path d="M8 7h5v5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="m4 10.5 4 4 8-9" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
      fill="none"
    >
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/*
 * Two visual states, three redundant signals each.
 *
 * WCAG 1.4.1: the applied/not-applied difference must survive greyscale, so it
 * is carried by the LABEL ("Aplicar" vs "Aplicada"), by the ICON (arrow vs
 * check) and only then by colour. Remove the colour and the button still tells
 * you exactly where you stand.
 */
const BASE =
  'group inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold ' +
  'shadow-sm transition duration-150 sm:w-auto motion-reduce:transition-none';

/* The one primary action: gradient fill and a coloured glow, as in the reference. */
const NOT_APPLIED =
  'btn-grad active:translate-y-px ' + 'motion-reduce:active:translate-y-0';

const APPLIED =
  'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-400 ' +
  'hover:bg-emerald-100 active:translate-y-px motion-reduce:active:translate-y-0';

export function ApplyLink({
  jobId,
  url,
  applied,
  title,
}: {
  jobId: string;
  url: string;
  applied: boolean;
  title: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleApply() {
    startTransition(async () => {
      const result = await applyToJobAction(jobId);
      setFeedback(translateActionMessage(result.message));
    });
  }

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleApply}
        className={`${BASE} ${applied ? APPLIED : NOT_APPLIED}`}
      >
        {isPending ? <Spinner /> : applied ? <CheckIcon /> : null}
        <span>{isPending ? ES.apply.pending : applied ? ES.apply.applied : ES.apply.action}</span>
        {!isPending && <ArrowIcon />}
        <span className="sr-only">
          {applied ? ES.apply.screenReaderApplied(title) : ES.apply.screenReader(title)}
        </span>
      </a>

      {/*
        The dual purpose, always visible. This is the sentence that stops the
        user wondering whether the click was also recorded.
      */}
      <p className="max-w-[15rem] text-xs leading-snug text-slate-500 sm:text-right">
        {applied ? ES.apply.dualPurposeApplied : ES.apply.dualPurpose}
      </p>

      {/* Announced politely so a screen reader hears the result without stealing focus. */}
      <p
        aria-live="polite"
        className="min-h-[1rem] text-xs font-medium text-slate-600 sm:text-right"
      >
        {isPending ? ES.apply.pending : (feedback ?? '')}
      </p>
    </div>
  );
}
