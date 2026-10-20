import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomically } from './atomic-file.js';
import {
  MAIL_PROPOSAL_OUTCOMES,
  MAIL_PROPOSAL_STATUSES,
  type MailProposal,
} from '../../domain/mail-proposal.js';
import type {
  AddMailProposalResult,
  MailProposalRepository,
} from '../../ports/mail-proposal-repository.js';

/**
 * Pending mail proposals on disk: one JSON file, written atomically.
 *
 * A corrupt file is REFUSED, never reset: it holds the user's pending decisions
 * and the dedupe keys that stop a mail from being proposed again. The user moves
 * the file aside to start over. A missing file is simply empty.
 *
 * Concurrency is in-process only, like the other JSON stores.
 */

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), 'not an ISO date');

const proposalSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    proposedOutcome: z.enum(MAIL_PROPOSAL_OUTCOMES),
    messageId: z.string().min(1),
    snippet: z.string(),
    evidence: z.array(z.string()),
    detectedAt: isoDate,
    status: z.enum(MAIL_PROPOSAL_STATUSES),
    historyEntryId: z.string().min(1).optional(),
  })
  .strict();

const fileSchema = z.object({ version: z.literal(1), proposals: z.array(proposalSchema) }).strict();

export interface JsonMailProposalRepositoryOptions {
  readonly filePath: string;
}

function isMissingFile(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  );
}

function newestFirst(proposals: readonly MailProposal[]): MailProposal[] {
  return [...proposals].sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
}

export function createJsonMailProposalRepository(
  options: JsonMailProposalRepositoryOptions,
): MailProposalRepository {
  const target = resolve(options.filePath);
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation, operation);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readAll(): Promise<MailProposal[]> {
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch (cause: unknown) {
      if (isMissingFile(cause)) {
        return [];
      }
      throw cause;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(
        `The mail proposals at ${target} are not valid JSON. Refusing to overwrite them - ` +
          'move the file aside if you want to start over.',
      );
    }

    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `The mail proposals at ${target} do not match the expected schema: ` +
          `${parsed.error.issues[0]?.message ?? 'unknown error'}. Refusing to overwrite them.`,
      );
    }

    return parsed.data.proposals.map(({ detectedAt, historyEntryId, ...rest }) => ({
      ...rest,
      detectedAt: new Date(detectedAt),
      ...(historyEntryId === undefined ? {} : { historyEntryId }),
    }));
  }

  async function writeAll(proposals: readonly MailProposal[]): Promise<void> {
    const payload = `${JSON.stringify(
      {
        version: 1,
        proposals: proposals.map((proposal) => ({
          id: proposal.id,
          jobId: proposal.jobId,
          proposedOutcome: proposal.proposedOutcome,
          messageId: proposal.messageId,
          snippet: proposal.snippet,
          evidence: proposal.evidence,
          detectedAt: proposal.detectedAt.toISOString(),
          status: proposal.status,
          ...(proposal.historyEntryId === undefined ? {} : { historyEntryId: proposal.historyEntryId }),
        })),
      },
      null,
      2,
    )}\n`;
    await writeFileAtomically(target, payload, 'mail-proposals');
  }

  async function transition(
    id: string,
    change: (current: MailProposal) => MailProposal,
  ): Promise<MailProposal | null> {
    const all = await readAll();
    const index = all.findIndex((proposal) => proposal.id === id);
    const current = all[index];
    if (current === undefined || current.status !== 'pending') {
      return null;
    }
    const next = change(current);
    await writeAll(all.map((proposal, i) => (i === index ? next : proposal)));
    return next;
  }

  return {
    list: () => exclusive(async () => newestFirst(await readAll())),

    listPending: () =>
      exclusive(async () => newestFirst((await readAll()).filter((p) => p.status === 'pending'))),

    findByMessageId: (messageId) =>
      exclusive(async () => (await readAll()).find((p) => p.messageId === messageId) ?? null),

    add: (proposal) =>
      exclusive(async (): Promise<AddMailProposalResult> => {
        const all = await readAll();
        const existing = all.find((p) => p.messageId === proposal.messageId);
        if (existing !== undefined) {
          return { proposal: existing, created: false };
        }
        await writeAll([...all, proposal]);
        return { proposal, created: true };
      }),

    markAccepted: (id, historyEntryId) =>
      exclusive(() => transition(id, (current) => ({ ...current, status: 'accepted', historyEntryId }))),

    markDismissed: (id) =>
      exclusive(() => transition(id, (current) => ({ ...current, status: 'dismissed' }))),
  };
}
