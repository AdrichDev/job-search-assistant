import type { ApplicationOutcome } from '@job-queue/core';
import { isResponse } from '@job-queue/core';
import { ES } from '@/copy/es';

/**
 * UI-2: the tracking cells use the SAME colours as the user's historical Excel
 * (read from its conditional formatting), so the tracking table feels familiar:
 *
 *   Aceptado  -> green (#DCFCE7 on #166534), bold
 *   Rechazado -> red (#FEE2E2 on #991B1B)
 *   En proceso -> blue (#DBEAFE on #1D4ED8), bold
 *
 * `no_reply` has no Excel equivalent, so it gets a neutral explicit style.
 *
 * The classes are full literal arbitrary-value class names (they bypass the
 * dark-theme mirror in `tailwind.config.ts` on purpose: these are spreadsheet
 * colours, not theme colours). The Spanish status word always travels with the
 * colour, so colour is never the only signal.
 */

/** One spreadsheet cell: the Tailwind classes and the Spanish word to show. */
export interface CellStyle {
  readonly className: string;
  readonly label: string;
}

/** The Estado column, one style per application outcome. */
const ESTADO_CLASSES: Readonly<Record<ApplicationOutcome, string>> = {
  rejected: 'bg-[#FEE2E2] text-[#991B1B]',
  applied: 'bg-[#DBEAFE] text-[#1D4ED8] font-bold',
  screening: 'bg-[#DBEAFE] text-[#1D4ED8] font-bold',
  interview: 'bg-[#DBEAFE] text-[#1D4ED8] font-bold',
  offer: 'bg-[#DCFCE7] text-[#166534] font-bold',
  no_reply: 'bg-[#E2E8F0] text-[#334155]',
};

export function estadoCellStyle(outcome: ApplicationOutcome): CellStyle {
  return { className: ESTADO_CLASSES[outcome], label: ES.status[outcome] };
}

const YES_CLASSES = 'bg-[#DCFCE7] text-[#166534] font-bold';
const NO_CLASSES = 'bg-[#FEE2E2] text-[#991B1B]';

/** The ¿Contestó? column: a reply (any reply, rejections included) is Sí. */
export function replyCellStyle(outcome: ApplicationOutcome): CellStyle {
  return isResponse(outcome)
    ? { className: YES_CLASSES, label: 'Sí' }
    : { className: NO_CLASSES, label: 'No' };
}

/**
 * The HEADINGS of those two columns, in the same spreadsheet palette.
 *
 * The cells were already coloured while the headings stayed grey, which reads as
 * two different tables glued together. Estado takes the "En proceso" blue (the
 * dominant state of that column) and ¿Contestó? the "Sí" green.
 */
export const ESTADO_HEADER_CLASS = 'bg-[#DBEAFE] text-[#1D4ED8]';
export const RESPONDED_HEADER_CLASS = 'bg-[#DCFCE7] text-[#166534]';
