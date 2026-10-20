import { ApplicationPatchError, type Application } from '../domain/application.js';
import {
  analyzeHistory,
  diffApplications,
  fieldValue,
  patchRestoring,
  sameChangeValue,
  type ApplicationChange,
} from '../domain/application-history.js';
import type { ApplicationHistoryRepository } from '../ports/application-history-repository.js';
import type { ApplicationRepository } from '../ports/application-repository.js';

/**
 * Undo one logged change (CU7: every change is reversible).
 *
 * Allowed only for an entry `analyzeHistory` offers as undoable (the newest live
 * entry, or the newest entry when it is itself an undo) and only while the
 * application still holds exactly the values that entry left behind. If anything
 * changed outside the log in the meantime the answer is `conflict` and nothing
 * is written: undoing would silently destroy that other change.
 *
 * The undo is itself a new history entry (source `revert`); the log is never
 * edited. Known limitation: undoing the creation of a listing clears its
 * optional fields but keeps company and title (a listing cannot be removed).
 */

export interface RevertApplicationChangeInput {
  readonly entryId: string;
}

export interface RevertApplicationChangeDeps {
  readonly repository: ApplicationRepository;
  readonly history: ApplicationHistoryRepository;
  readonly now: () => Date;
  readonly newId?: () => string;
}

export type RevertApplicationChangeResult =
  | {
      readonly status: 'reverted';
      readonly application: Application;
      /** False when the application was restored but the undo entry could not be written. */
      readonly historyRecorded: boolean;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_reverted' }
  | { readonly status: 'not_latest' }
  | { readonly status: 'conflict' };

function stillHoldsAfterValues(application: Application, entry: ApplicationChange): boolean {
  return entry.changes.every((change) => sameChangeValue(fieldValue(application, change.field), change.after));
}

export async function revertApplicationChange(
  input: RevertApplicationChangeInput,
  deps: RevertApplicationChangeDeps,
): Promise<RevertApplicationChangeResult> {
  const entry = await deps.history.find(input.entryId);
  if (entry === null) {
    return { status: 'not_found' };
  }

  const analysis = analyzeHistory(await deps.history.listFor(entry.jobId));
  if (analysis.reverted.has(entry.id)) {
    return { status: 'already_reverted' };
  }
  if (!analysis.undoable.includes(entry.id)) {
    return { status: 'not_latest' };
  }

  const current = await deps.repository.findByJobId(entry.jobId);
  if (current === null || !stillHoldsAfterValues(current, entry)) {
    return { status: 'conflict' };
  }

  const patch = { ...patchRestoring(entry.changes) };
  const touchesOutcome = entry.changes.some((change) => change.field === 'outcome');
  const touchesOutcomeDate = entry.changes.some((change) => change.field === 'outcomeUpdatedAt');
  if (touchesOutcome && !touchesOutcomeDate) {
    // Without an explicit date the domain would stamp "now" on an outcome change.
    Object.assign(patch, { outcomeUpdatedAt: current.outcomeUpdatedAt });
  }

  const hasRestorable = Object.keys(patch).length > 0;
  let updated: { readonly before: Application; readonly after: Application } | null = null;
  if (hasRestorable) {
    try {
      updated = await deps.repository.update({ jobId: entry.jobId, patch, now: deps.now() });
    } catch (cause: unknown) {
      if (cause instanceof ApplicationPatchError) {
        // A refusal of the domain means the stored value cannot be put back as it was.
        return { status: 'conflict' };
      }
      throw cause;
    }
    if (updated === null) {
      return { status: 'conflict' };
    }
    if (diffApplications(updated.before, updated.after).length === 0) {
      // Someone else already restored it between the check and the write.
      return { status: 'already_reverted' };
    }
  }

  const before = updated?.before ?? current;
  const after = updated?.after ?? current;
  const revertEntry: ApplicationChange = {
    id: (deps.newId ?? (() => globalThis.crypto.randomUUID()))(),
    jobId: entry.jobId,
    at: deps.now(),
    source: 'revert',
    changes: diffApplications(before, after),
    revertsId: entry.id,
  };

  let historyRecorded = true;
  try {
    await deps.history.append(revertEntry);
  } catch {
    historyRecorded = false;
  }
  return { status: 'reverted', application: after, historyRecorded };
}
