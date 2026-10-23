'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { consoleLogger } from '@job-queue/core';
import {
  applicationHistoryRepository,
  applicationRepository,
  mailProposalRepository,
} from '@/server/container';
import {
  acceptAllFromForm,
  acceptFromForm,
  catchUp,
  checkNow,
  dismissFromForm,
} from '@/server/mail-actions-core';
import { mailCheckDeps } from '@/server/refresh';

/**
 * Thin shells over `@/server/mail-actions-core` (unit-tested there). Form posts
 * that redirect with a closed Spanish slug; none of them echoes an error.
 * Covered end to end by the U5e e2e, not by unit tests.
 */

function refresh(): void {
  revalidatePath('/');
  revalidatePath('/seguimiento');
}

// `redirect` throws by design, so it is always called outside any try/catch.
// The core functions swallow their own failures; only dependency building can
// throw here, and that is caught below to keep the page from a 500.

export async function acceptMailProposalAction(formData: FormData): Promise<void> {
  let to = '/seguimiento?correo=rechazada#correo';
  try {
    to = await acceptFromForm(formData, {
      proposals: mailProposalRepository(),
      applications: applicationRepository(),
      history: applicationHistoryRepository(),
      now: () => new Date(),
      logger: consoleLogger,
    });
    refresh();
  } catch {
    // keep the generic target
  }
  redirect(to);
}

/** The modal's Aceptar: applies EVERY pending proposal, one redirect with the tally. */
export async function acceptAllMailProposalsAction(): Promise<void> {
  let to = '/seguimiento?correo=rechazada#correo';
  try {
    to = await acceptAllFromForm({
      proposals: mailProposalRepository(),
      applications: applicationRepository(),
      history: applicationHistoryRepository(),
      now: () => new Date(),
      logger: consoleLogger,
    });
    refresh();
  } catch {
    // keep the generic target
  }
  redirect(to);
}

export async function dismissMailProposalAction(formData: FormData): Promise<void> {
  let to = '/seguimiento?correo=no-encontrada#correo';
  try {
    to = await dismissFromForm(formData, { proposals: mailProposalRepository() });
    refresh();
  } catch {
    // keep the generic target
  }
  redirect(to);
}

/** The manual button: forced, bypasses the not-due check and the cooldown. */
export async function checkMailNowAction(): Promise<void> {
  let to = '/seguimiento?correo=fallo#correo';
  try {
    to = await checkNow(mailCheckDeps());
    refresh();
  } catch {
    // keep the generic target
  }
  redirect(to);
}

/** Called from a client effect: never redirects, never throws. */
export async function catchUpMailAction(): Promise<{ ran: boolean }> {
  try {
    const { ran } = await catchUp(mailCheckDeps());
    return { ran };
  } catch {
    return { ran: false };
  }
}
