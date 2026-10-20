import { createHash } from 'node:crypto';
import type { Application, ApplicationOutcome } from '../domain/application.js';
import { createMailProposal } from '../domain/mail-proposal.js';
import { classifyReply } from '../domain/mail-reply.js';
import { containsTerm, normalizeText } from '../domain/text.js';
import type { MailMessage } from '../ports/gmail-reader.js';
import type { MailProposalRepository } from '../ports/mail-proposal-repository.js';

/**
 * Turns clear company replies into PENDING proposals. Never changes an
 * application: it receives them as read-only data and has no write path to the
 * application log. The user confirms or dismisses each proposal later.
 *
 * A message becomes a proposal only when ALL of this holds:
 * - the classifier finds a clear signal;
 * - no proposal for that message id exists yet (idempotent: reruns, overlapping
 *   mail windows and dismissed proposals never duplicate);
 * - exactly ONE still-open application matches it: the application's company is
 *   named by the sender, subject or snippet, and the message is not older than
 *   the application;
 * - the proposed outcome differs from the application's current one.
 * Zero matches is `unmatched`, several is `ambiguous`; neither guesses.
 */

export interface ProposeFromMailInput {
  readonly messages: readonly MailMessage[];
  readonly applications: readonly Application[];
  readonly repository: MailProposalRepository;
  readonly now: () => Date;
}

export interface ProposeFromMailResult {
  readonly proposed: number;
  readonly skippedNoSignal: number;
  readonly skippedDuplicate: number;
  readonly unmatched: number;
  readonly ambiguous: number;
  readonly unchanged: number;
}

const OPEN_OUTCOMES: readonly ApplicationOutcome[] = ['applied', 'screening', 'interview'];

/** Legal-form words that senders and subjects usually leave out. */
const LEGAL_SUFFIXES = new Set(['sl', 's.l.', 's.l', 'slu', 'sa', 's.a.', 's.a', 'ltd', 'inc', 'llc', 'gmbh']);
const MIN_COMPANY_LENGTH = 3;

/** Same source of the company as the importer: the listing, else the id fingerprint. */
function companyOf(application: Application): string {
  const raw = application.listing?.company ?? application.jobId.split('::')[0] ?? '';
  const tokens = normalizeText(raw)
    .split(' ')
    .filter((token) => token.length > 0);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1] ?? '')) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function mentionsCompany(message: MailMessage, company: string): boolean {
  if (company.length < MIN_COMPANY_LENGTH) {
    return false;
  }
  const haystack = normalizeText(`${message.from} ${message.subject} ${message.snippet}`);
  if (containsTerm(haystack, company)) {
    return true;
  }
  // `acme software` should also be recognised in an address such as `@acmesoftware.com`.
  const compact = company.replace(/[^a-z0-9]/g, '');
  return compact.length >= MIN_COMPANY_LENGTH && containsTerm(haystack, compact);
}

function proposalId(messageId: string): string {
  return `mail-${createHash('sha1').update(messageId).digest('hex').slice(0, 16)}`;
}

export async function proposeFromMail(input: ProposeFromMailInput): Promise<ProposeFromMailResult> {
  const counts = {
    proposed: 0,
    skippedNoSignal: 0,
    skippedDuplicate: 0,
    unmatched: 0,
    ambiguous: 0,
    unchanged: 0,
  };

  const open = input.applications
    .filter((application) => OPEN_OUTCOMES.includes(application.outcome))
    .map((application) => ({ application, company: companyOf(application) }));

  for (const message of input.messages) {
    const reply = classifyReply({ subject: message.subject, snippet: message.snippet });
    if (reply === null) {
      counts.skippedNoSignal += 1;
      continue;
    }

    if ((await input.repository.findByMessageId(message.id)) !== null) {
      counts.skippedDuplicate += 1;
      continue;
    }

    const matches = open.filter(
      ({ application, company }) =>
        message.receivedAt.getTime() >= application.appliedAt.getTime() &&
        mentionsCompany(message, company),
    );
    if (matches.length === 0) {
      counts.unmatched += 1;
      continue;
    }
    const [match] = matches;
    if (matches.length > 1 || match === undefined) {
      counts.ambiguous += 1;
      continue;
    }

    if (match.application.outcome === reply.outcome) {
      counts.unchanged += 1;
      continue;
    }

    const added = await input.repository.add(
      createMailProposal({
        id: proposalId(message.id),
        jobId: match.application.jobId,
        proposedOutcome: reply.outcome,
        basedOnOutcome: match.application.outcome,
        messageId: message.id,
        snippet: message.snippet,
        evidence: reply.evidence,
        detectedAt: input.now(),
      }),
    );
    if (added.created) {
      counts.proposed += 1;
    } else {
      counts.skippedDuplicate += 1;
    }
  }

  return counts;
}
