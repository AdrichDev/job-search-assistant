import {
  ApplicationPatchError,
  applicationsEqual,
  type Application,
  type ApplicationPatch,
  type PatchRefusalReason,
} from '../domain/application.js';
import { diffApplications, type ApplicationChange, type ChangeSource } from '../domain/application-history.js';
import type { ApplicationHistoryRepository } from '../ports/application-history-repository.js';
import type { ApplicationRepository } from '../ports/application-repository.js';

/**
 * "The human corrects their own record by hand."
 *
 * The rules live in `applyApplicationPatch`; the repository persists. This use
 * case only translates the outcome into a status a caller can map to a message.
 * Reasons are fixed machine codes and never echo what the human typed.
 */

export interface EditApplicationInput {
  readonly jobId: string;
  readonly patch: ApplicationPatch;
  /** Who is making the change; defaults to `manual`. */
  readonly source?: ChangeSource;
}

export interface EditApplicationDeps {
  readonly repository: ApplicationRepository;
  readonly now: () => Date;
  /** When present, every edit that really changed something is logged (source `manual` unless the input says otherwise). */
  readonly history?: ApplicationHistoryRepository;
  /** Entry id generator; defaults to a random UUID. */
  readonly newId?: () => string;
}

export type EditApplicationResult =
  | {
      readonly status: 'updated';
      readonly before: Application;
      readonly after: Application;
      /**
       * False when the edit was saved but the history entry could not be written
       * (or no history is configured). The edit is never rolled back and the
       * failure is never hidden: the caller must tell the person.
       */
      readonly historyRecorded: boolean;
      /** The id of the entry written; absent when nothing was recorded. */
      readonly historyEntryId?: string;
    }
  | { readonly status: 'unchanged'; readonly application: Application }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid'; readonly reason: PatchRefusalReason };

export async function editApplication(
  input: EditApplicationInput,
  deps: EditApplicationDeps,
): Promise<EditApplicationResult> {
  try {
    const result = await deps.repository.update({
      jobId: input.jobId,
      patch: input.patch,
      now: deps.now(),
    });
    if (result === null) {
      return { status: 'not_found' };
    }
    if (applicationsEqual(result.before, result.after)) {
      return { status: 'unchanged', application: result.after };
    }
    const recorded = await recordChange(result.before, result.after, deps, input.source ?? 'manual');
    return {
      status: 'updated',
      before: result.before,
      after: result.after,
      historyRecorded: recorded.recorded,
      ...(recorded.entryId === undefined ? {} : { historyEntryId: recorded.entryId }),
    };
  } catch (cause: unknown) {
    // Only a domain refusal is a result; I/O failures must stay loud.
    if (cause instanceof ApplicationPatchError) {
      return { status: 'invalid', reason: cause.reason };
    }
    throw cause;
  }
}

/** Appends one entry for the diff; not recorded when there is no history or the write failed. */
async function recordChange(
  before: Application,
  after: Application,
  deps: EditApplicationDeps,
  source: ChangeSource,
): Promise<{ readonly recorded: boolean; readonly entryId?: string }> {
  if (deps.history === undefined) {
    return { recorded: false };
  }
  const changes = diffApplications(before, after);
  if (changes.length === 0) {
    return { recorded: true };
  }
  const entry: ApplicationChange = {
    id: (deps.newId ?? (() => globalThis.crypto.randomUUID()))(),
    jobId: before.jobId,
    at: deps.now(),
    source,
    changes,
  };
  try {
    await deps.history.append(entry);
    return { recorded: true, entryId: entry.id };
  } catch {
    return { recorded: false };
  }
}
