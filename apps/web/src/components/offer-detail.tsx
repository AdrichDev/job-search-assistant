'use client';

import { useRef, useState } from 'react';
import { ES } from '@/copy/es';

/**
 * "Abrir" and the detail modal, point 8 of the list: "Cuando se de en abrir se
 * tiene que abrir un modal (tambien con fondo blur con detalles mas concretos de
 * la oferta)".
 *
 * Same surface rules as the mail modal, and for the same reason: this theme
 * mirrors the light palette, so `bg-slate-900` would paint a near-white card over
 * a near-white backdrop. Explicit values instead -#0f172a on a dimmed, blurred
 * black backdrop-, and the facts the card had to compress appear here in full.
 */

export interface OfferDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface OfferDetailProps {
  readonly title: string;
  readonly company: string;
  readonly rows: readonly OfferDetailRow[];
  readonly requirements: readonly string[];
  readonly applyHref: string;
  readonly applyLabel: string;
}

export function OfferDetail(props: OfferDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const show = () => {
    setOpen(true);
    dialogRef.current?.showModal();
  };
  const close = () => {
    setOpen(false);
    dialogRef.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="rounded-lg border border-[#475569] px-4 py-2 text-sm font-medium text-[#e2e8f0] hover:bg-[#1e293b]"
      >
        {ES.detail.open}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`offer-detail-${props.applyHref}`}
        data-testid="offer-detail-modal"
        className="max-w-2xl rounded-xl border border-[#334155] bg-[#0f172a] p-6 text-[#e2e8f0] shadow-2xl [&::backdrop]:bg-black/70 [&::backdrop]:backdrop-blur-sm"
      >
        {open && (
          <div className="space-y-4">
            <div>
              <h2 id={`offer-detail-${props.applyHref}`} className="text-lg font-semibold text-[#f8fafc]">
                {props.title}
              </h2>
              <p className="mt-1 text-sm text-[#94a3b8]">{props.company}</p>
            </div>

            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {props.rows.map((row) => (
                <div key={row.label} className="rounded-lg border border-[#334155] bg-[#172033] p-3">
                  <dt className="text-xs uppercase tracking-wide text-[#94a3b8]">{row.label}</dt>
                  <dd className="mt-0.5 font-medium text-[#f8fafc]">{row.value}</dd>
                </div>
              ))}
            </dl>

            {props.requirements.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                  {ES.detail.requirements}
                </h3>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {props.requirements.map((requirement) => (
                    <li
                      key={requirement}
                      className="rounded-md border border-[#334155] px-2 py-0.5 text-xs text-[#e2e8f0]"
                    >
                      {requirement}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-[#475569] px-4 py-2 text-sm font-medium text-[#e2e8f0] hover:bg-[#1e293b]"
              >
                {ES.detail.close}
              </button>
              <a
                href={props.applyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                {props.applyLabel}
              </a>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
