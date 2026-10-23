import 'server-only';

import { consoleLogger } from '@job-queue/core';
import {
  applicationRepository,
  mailProposalRepository,
  mailRunStateStore,
} from '@/server/container';
import { gmailReader, mailConfigured } from '@/server/mail';
import type { MailCheckDeps } from '@/server/mail-use-cases';

/**
 * The mail half of the "Actualizar" action, wired exactly as every other mail
 * entry point. One place, so the refresh cannot end up reading a different
 * store than the catch-up or the manual check - the same reason
 * `mail-status.ts` exists for the read side.
 */
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
