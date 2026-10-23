import 'server-only';

/*
 * The ONE mail wiring, shared by every entry point that reads the mailbox.
 *
 * The catch-up effect, the manual "Revisar correo ahora" and the mail half of
 * "Actualizar" all build the same dependencies here, so a refresh can never end
 * up reading a different store than the other two. That is the same reason
 * `mail-status.ts` exists on the read side: one place per direction.
 */

import { consoleLogger } from '@job-queue/core';
import {
  applicationRepository,
  mailProposalRepository,
  mailRunStateStore,
} from '@/server/container';
import { gmailReader, mailConfigured } from '@/server/mail';
import type { MailCheckDeps } from '@/server/mail-use-cases';

/** The mail review's dependencies, as `MailCheckDeps` expects them. */
export function mailCheckDeps(): MailCheckDeps {
  return {
    configured: () => mailConfigured(),
    reader: gmailReader(),
    store: mailRunStateStore(),
    proposals: mailProposalRepository(),
    applications: applicationRepository(),
    now: () => new Date(),
    logger: consoleLogger,
  };
}
