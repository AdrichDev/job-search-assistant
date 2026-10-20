import 'server-only';

import {
  analyzeHistory,
  type ApplicationChange,
  type ApplicationHistoryRepository,
} from '@job-queue/core';
import { ACTION_MESSAGES } from '@/copy/action-messages';
import { ES, translateActionMessage } from '@/copy/es';

/**
 * Read model of the change history shown on the edit page. Read-only, and it
 * never throws: an unreadable history degrades to a visible warning so the
 * person can still edit.
 */

export interface HistoryEntryView extends ApplicationChange {
  /** The effect of this entry was undone and still stands. */
  readonly reverted: boolean;
  /** The Deshacer button is offered for this entry. */
  readonly undoable: boolean;
}

export interface ApplicationHistoryData {
  /** Newest first. */
  readonly entries: readonly HistoryEntryView[];
  readonly warning: string | null;
}

export interface HistoryDeps {
  readonly historyRepository?: ApplicationHistoryRepository;
}

export function buildHistoryView(entries: readonly ApplicationChange[]): HistoryEntryView[] {
  const { reverted, undoable } = analyzeHistory(entries);
  return entries.map((entry) => ({
    ...entry,
    reverted: reverted.has(entry.id),
    undoable: undoable.includes(entry.id),
  }));
}

export async function loadApplicationHistory(
  jobId: string,
  deps: HistoryDeps,
): Promise<ApplicationHistoryData> {
  if (deps.historyRepository === undefined) {
    return { entries: [], warning: ES.history.unavailableWarning };
  }
  try {
    return { entries: buildHistoryView(await deps.historyRepository.listFor(jobId)), warning: null };
  } catch (cause: unknown) {
    return { entries: [], warning: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface RevertNotice {
  readonly tone: 'success' | 'warning' | 'error';
  readonly text: string;
}

const REVERT_NOTICES: Readonly<Record<string, RevertNotice>> = {
  deshecho: { tone: 'success', text: translateActionMessage(ACTION_MESSAGES.changeReverted) },
  'deshecho-sin-registro': {
    tone: 'warning',
    text: translateActionMessage(ACTION_MESSAGES.changeRevertedNotLogged),
  },
  'no-encontrado': { tone: 'error', text: translateActionMessage(ACTION_MESSAGES.changeNotFound) },
  'ya-deshecho': { tone: 'error', text: translateActionMessage(ACTION_MESSAGES.changeAlreadyReverted) },
  'no-ultimo': { tone: 'error', text: translateActionMessage(ACTION_MESSAGES.changeNotLatest) },
  conflicto: { tone: 'error', text: translateActionMessage(ACTION_MESSAGES.changeConflict) },
  invalido: { tone: 'error', text: translateActionMessage(ACTION_MESSAGES.invalidInput) },
  'sin-historial': { tone: 'error', text: translateActionMessage(ACTION_MESSAGES.historyUnavailable) },
};

/** `?deshacer=` is user-controlled: only the known codes produce a notice. */
export function revertNoticeFor(raw: string | readonly string[] | undefined): RevertNotice | null {
  return typeof raw === 'string' ? (REVERT_NOTICES[raw] ?? null) : null;
}
