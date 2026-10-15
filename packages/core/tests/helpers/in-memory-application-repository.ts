import {
  createApplication,
  withOutcome,
  type Application,
  type ApplicationDraft,
} from '../../src/domain/application.js';
import type {
  ApplicationRepository,
  RecordResult,
  UpdateOutcomeInput,
} from '../../src/ports/application-repository.js';

/**
 * In-memory `ApplicationRepository` for use-case tests.
 *
 * Mirrors the JSON adapter's contract, idempotency included, so app-layer tests
 * do not need a temp directory. The adapter's own durability guarantees are
 * covered by its dedicated test.
 */
export function createInMemoryApplicationRepository(
  seed: readonly Application[] = [],
): ApplicationRepository {
  const byJobId = new Map<string, Application>(
    seed.map((application) => [application.jobId, application]),
  );

  return {
    async list(): Promise<readonly Application[]> {
      return [...byJobId.values()].sort(
        (a, b) => b.appliedAt.getTime() - a.appliedAt.getTime(),
      );
    },

    async findByJobId(jobId: string): Promise<Application | null> {
      return byJobId.get(jobId.trim()) ?? null;
    },

    async record(draft: ApplicationDraft): Promise<RecordResult> {
      const jobId = draft.jobId.trim();
      const existing = byJobId.get(jobId);
      if (existing !== undefined) {
        return { application: existing, created: false };
      }

      const application = createApplication(draft);
      byJobId.set(jobId, application);
      return { application, created: true };
    },

    async updateOutcome(input: UpdateOutcomeInput): Promise<Application | null> {
      const jobId = input.jobId.trim();
      const current = byJobId.get(jobId);
      if (current === undefined) {
        return null;
      }

      const updated = withOutcome(
        current,
        input.outcome,
        input.at,
        ...(input.notes === undefined ? [] : ([input.notes] as const)),
      );
      byJobId.set(jobId, updated);
      return updated;
    },
  };
}
