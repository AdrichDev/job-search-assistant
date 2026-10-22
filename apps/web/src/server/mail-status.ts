import { consoleLogger } from '@job-queue/core';
import { mailProposalRepository, mailRunStateStore } from '@/server/container';
import { mailConfigured } from '@/server/mail';
import { readMailStatus, type MailStatus } from '@/server/mail-use-cases';

/**
 * The mail state, read the same way from every page that shows it.
 *
 * One place for the wiring, because the alternative already happened once: two
 * pages each assembling the same five dependencies by hand, which is how a page
 * ends up reading a different store than the other one.
 *
 * This is a READ. The catch-up and the check are explicit actions elsewhere; a
 * page render must never write the run state.
 */
export function readMailStatusNow(): Promise<MailStatus> {
  return readMailStatus({
    configured: () => mailConfigured(),
    store: mailRunStateStore(),
    proposals: mailProposalRepository(),
    now: () => new Date(),
    logger: consoleLogger,
  });
}
