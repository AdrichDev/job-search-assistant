import type {
  Application,
  ApplicationChange,
  ApplicationHistoryRepository,
  ApplicationRepository,
  Dismissal,
  DismissalRepository,
} from '@job-queue/core';

/** Read-only stub: the dashboard never writes, so the write paths throw if used. */
export function createStubRepository(
  applications: readonly Application[],
): ApplicationRepository {
  return {
    list: async () => applications,
    findByJobId: async (jobId) =>
      applications.find((application) => application.jobId === jobId) ?? null,
    record: async () => {
      throw new Error('The dashboard read model must not write applications.');
    },
    updateOutcome: async () => {
      throw new Error('The dashboard read model must not write applications.');
    },
    update: async () => {
      throw new Error('The dashboard read model must not write applications.');
    },
  };
}

/** Same posture for dismissals: the read model reads, it never writes. */
export function createStubDismissals(
  dismissals: readonly Dismissal[] = [],
): DismissalRepository {
  return {
    list: async () => dismissals,
    findByJobId: async (jobId) =>
      dismissals.find((dismissal) => dismissal.jobId === jobId) ?? null,
    dismiss: async () => {
      throw new Error('The dashboard read model must not write dismissals.');
    },
    restore: async () => {
      throw new Error('The dashboard read model must not write dismissals.');
    },
  };
}

/** Read-only history stub. `failReads` simulates a corrupt history file. */
export function createStubHistory(
  entries: readonly ApplicationChange[] = [],
  options: { failReads?: boolean } = {},
): ApplicationHistoryRepository {
  return {
    append: async () => {
      throw new Error('The history read model must not write the history.');
    },
    listFor: async (jobId) => {
      if (options.failReads === true) {
        throw new Error('The application history log is not valid JSON.');
      }
      return entries.filter((entry) => entry.jobId === jobId);
    },
    find: async (id) => entries.find((entry) => entry.id === id) ?? null,
  };
}
