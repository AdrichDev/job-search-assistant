'use client';

import { useEffect, useRef, type MouseEvent } from 'react';
import { acceptAllMailProposalsAction } from '@/app/mail-actions';
import { ES } from '@/copy/es';

/**
 * The ONE confirmation modal of U5d (L51-L52): every pending mail proposal that
 * would change an application, listed in a real accessible dialog.
 *
 * - It opens BY ITSELF when there are pending proposals, ONCE per page visit:
 *   the ref survives StrictMode's double mount and `router.refresh()`, the
 *   same pattern as `mail-catchup.tsx`. `showModal` runs in an effect, never
 *   during render.
 * - Native `<dialog>.showModal()` gives the focus trap, the initial focus
 *   inside and Escape-for-free; Escape closing the dialog IS Cancelar.
 * - Aceptar is a plain form post to the bulk server action, so it also works
 *   without JavaScript. Cancelar closes the dialog when JS runs and is a
 *   plain form navigation when it does not; either way nothing is applied.
 */

export interface MailModalRow {
  readonly id: string;
  readonly company: string;
  readonly title: string;
  /** Spanish label of the application's current state, or null when it is gone. */
  readonly currentState: string | null;
  readonly proposedState: string;
  readonly snippet: string;
}

export function MailProposalsModal({ rows }: { readonly rows: readonly MailModalRow[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const autoOpened = useRef(false);

  useEffect(() => {
    if (autoOpened.current || rows.length === 0) {
      return;
    }
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    autoOpened.current = true;
    dialog.showModal();
  }, [rows.length]);

  if (rows.length === 0) {
    return null;
  }

  /**
   * Cancelar. The button is a real submit inside a form so the no-JavaScript
   * path still navigates back to the list; with JavaScript the submit is
   * prevented and the dialog closes in place. Without `preventDefault` the
   * browser navigates anyway, which reloads the page and re-opens the modal by
   * itself, making Cancelar look like it did nothing.
   */
  const cancel = (event: MouseEvent<HTMLButtonElement>) => {
    const dialog = dialogRef.current;
    if (dialog !== null && dialog.open) {
      event.preventDefault();
      dialog.close();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="mail-proposals-heading"
      data-testid="mail-proposals-modal"
      className="max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-6 text-slate-100 shadow-2xl [&::backdrop]:bg-slate-950/70"
    >
      <div className="space-y-4">
        <h2 id="mail-proposals-heading" className="text-lg font-semibold">
          {ES.mail.modal.heading}
        </h2>
        <p className="text-sm text-slate-300">{ES.mail.modal.intro(rows.length)}</p>
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm"
            >
              <p className="font-medium">
                {row.company}
                {row.title.length > 0 ? ` — ${row.title}` : ''}
              </p>
              <dl className="mt-2 space-y-1 text-slate-300">
                {row.currentState !== null && (
                  <div className="flex gap-2">
                    <dt className="shrink-0">{ES.mail.modal.currentState}:</dt>
                    <dd>{row.currentState}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="shrink-0">{ES.mail.modal.proposedState}:</dt>
                  <dd className="font-medium text-slate-100">{row.proposedState}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0">{ES.mail.modal.evidence}:</dt>
                  <dd className="italic">«{row.snippet}»</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-3">
          <form action="/seguimiento">
            <button
              type="submit"
              onClick={cancel}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              {ES.mail.modal.cancel}
            </button>
          </form>
          <form action={acceptAllMailProposalsAction}>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              {ES.mail.labels.accept}
            </button>
          </form>
        </div>
      </div>
    </dialog>
  );
}
