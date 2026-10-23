'use client';

import { useRef, useState } from 'react';
import type { JobRequirements, ScoreBreakdownItem } from '@job-queue/core/domain';
import { ApplyLink } from '@/components/apply-link';
import { dimensionLabel, ES } from '@/copy/es';

/**
 * "Abrir" and the detail modal, point 8 of the list: "Cuando se de en abrir se
 * tiene que abrir un modal (tambien con fondo blur con detalles mas concretos de
 * la oferta)".
 *
 * Same surface rules as the mail modal, and for the same reason: this theme
 * mirrors the light palette, so `bg-slate-900` would paint a near-white card over
 * a near-white backdrop. Explicit values instead -#0f172a on a dimmed, blurred
 * black backdrop-, and the facts the card had to compress appear here in full:
 * the COMPLETE description, the complete requirements, the score breakdown and
 * the per-source links.
 *
 * Ver is not aplicar, here too: "Ver la oferta" is a plain link out that
 * records nothing, and "Aplicar" is the control that writes to the log. The
 * link is styled as a link, never as a button, so the two cannot be confused.
 */

export interface OfferDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface OfferDetailSourceLink {
  readonly label: string;
  readonly url: string;
}

export interface OfferDetailProps {
  /** Stable DOM id for the dialog; the vacancy fingerprint is unique enough. */
  readonly detailId: string;
  readonly title: string;
  readonly company: string;
  readonly rows: readonly OfferDetailRow[];
  /** The full posting text; absent on queue files written before it was kept. */
  readonly description?: string;
  readonly requirements: JobRequirements;
  readonly breakdown: readonly ScoreBreakdownItem[];
  readonly score: number;
  readonly sources: readonly OfferDetailSourceLink[];
  /** The apply control that RECORDS, exactly like the one on the card. */
  readonly jobId: string;
  readonly url: string;
  readonly applied: boolean;
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
        aria-labelledby={`offer-detail-${props.detailId}`}
        data-testid="offer-detail-modal"
        className="max-w-2xl rounded-xl border border-[#334155] bg-[#0f172a] p-6 text-[#e2e8f0] shadow-2xl [&::backdrop]:bg-black/70 [&::backdrop]:backdrop-blur-sm"
      >
        {open && (
          <div className="space-y-4">
            <div>
              <h2 id={`offer-detail-${props.detailId}`} className="text-lg font-semibold text-[#f8fafc]">
                {props.title}
              </h2>
              <p className="mt-1 text-sm text-[#94a3b8]">{props.company}</p>
            </div>

            {/*
              The full description, first where a job board puts it. Readable
              line length, paragraphs preserved, scrollable inside the dialog.
            */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                {ES.detail.description}
              </h3>
              {props.description === undefined || props.description.length === 0 ? (
                <p className="mt-1 text-sm italic text-[#94a3b8]">{ES.detail.noDescription}</p>
              ) : (
                <div className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-[#334155] bg-[#172033] p-3">
                  <p className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed text-[#e2e8f0]">
                    {props.description}
                  </p>
                </div>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {props.rows.map((row) => (
                <div key={row.label} className="rounded-lg border border-[#334155] bg-[#172033] p-3">
                  <dt className="text-xs uppercase tracking-wide text-[#94a3b8]">{row.label}</dt>
                  <dd className="mt-0.5 font-medium text-[#f8fafc]">{row.value}</dd>
                </div>
              ))}
            </dl>

            {/*
              Where the offer came from, as the links the pipeline actually
              fetched - one link per deduped source, never an invented portal.
            */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                {ES.detail.rows.sources}
              </h3>
              {props.sources.length === 0 ? (
                <p className="mt-1 text-sm italic text-[#94a3b8]">{ES.source.noSources}</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {props.sources.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-[#93c5fd] underline"
                      >
                        {source.label}
                        <span className="sr-only"> {ES.viewOffer.titleSuffix}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/*
              The score the card no longer shows: an explanation, not a verdict,
              with the dimension, its weighted points and the reason.
            */}
            {props.breakdown.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                  {ES.detail.scoreHeading}
                </h3>
                <table className="mt-1 w-full text-left text-sm">
                  <caption className="sr-only">{ES.score.tableCaption}</caption>
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">{ES.score.columnDimension}</th>
                      <th scope="col">{ES.score.columnContribution}</th>
                      <th scope="col">{ES.score.columnReason}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e293b]">
                    {props.breakdown.map((item) => (
                      <tr key={item.dimension} className="align-top">
                        <th scope="row" className="py-1.5 pr-3 font-medium text-[#f8fafc]">
                          {dimensionLabel(item.dimension)}
                        </th>
                        <td className="py-1.5 pr-3 tabular-nums text-[#e2e8f0]">
                          {ES.score.points(item.contribution.toFixed(1))}
                        </td>
                        <td className="py-1.5 text-xs leading-relaxed text-[#94a3b8]">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#334155]">
                      <th scope="row" className="pt-2 pr-3 font-semibold text-[#f8fafc]">
                        {ES.score.total}
                      </th>
                      <td colSpan={2} className="pt-2 font-semibold tabular-nums text-[#f8fafc]">
                        {ES.score.points(props.score.toFixed(1))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/*
              The requirements the card no longer shows: the detected stack,
              plus the facts the old chips carried, now in words.
            */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">
                {ES.detail.requirements}
              </h3>
              <dl className="mt-1 space-y-1 text-sm">
                {props.requirements.yearsRequired !== null && (
                  <div className="flex gap-2">
                    <dt className="text-[#94a3b8]">{ES.detail.requirementFacts.years}:</dt>
                    <dd className="font-medium text-[#f8fafc]">
                      {ES.card.yearsRequired(props.requirements.yearsRequired)}
                    </dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="text-[#94a3b8]">{ES.detail.requirementFacts.workMode}:</dt>
                  <dd className="font-medium text-[#f8fafc]">{ES.workMode[props.requirements.workMode]}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-[#94a3b8]">{ES.detail.requirementFacts.english}:</dt>
                  <dd className="font-medium text-[#f8fafc]">{ES.english[props.requirements.englishRequired]}</dd>
                </div>
                {props.requirements.senioritySignals.length > 0 && (
                  <div className="flex gap-2">
                    <dt className="text-[#94a3b8]">{ES.detail.requirementFacts.signals}:</dt>
                    <dd className="text-[#e2e8f0]">
                      {props.requirements.senioritySignals
                        .map((signal) =>
                          signal.level === 'junior'
                            ? signal.where === 'title'
                              ? ES.card.juniorSignalTitle
                              : ES.card.juniorSignalDescription
                            : signal.where === 'title'
                              ? ES.card.seniorSignalTitle
                              : ES.card.seniorSignalDescription,
                        )
                        .join(' · ')}
                    </dd>
                  </div>
                )}
              </dl>
              {props.requirements.matchedStack.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {props.requirements.matchedStack.map((technology) => (
                    <li
                      key={technology}
                      className="rounded-md border border-[#334155] px-2 py-0.5 text-xs text-[#e2e8f0]"
                    >
                      {technology}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {/*
                Ver la oferta: a LINK, visibly not a button, recording nothing.
              */}
              <a
                href={props.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[#93c5fd] underline hover:text-[#bfdbfe]"
              >
                {ES.viewOffer.dialogAction}
                <span className="sr-only"> {ES.viewOffer.titleSuffix}</span>
              </a>
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-[#475569] px-4 py-2 text-sm font-medium text-[#e2e8f0] hover:bg-[#1e293b]"
              >
                {ES.detail.close}
              </button>
              {/*
                Aplicar: the same recording control the card uses, so opening
                the dialog never becomes a second, silent way to "apply".
              */}
              <ApplyLink
                jobId={props.jobId}
                url={props.url}
                applied={props.applied}
                title={props.title}
              />
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}