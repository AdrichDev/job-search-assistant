import { isApplicationOutcome, type Application } from '../domain/application.js';
import type { ApplicationRepository } from '../ports/application-repository.js';

/**
 * "The human heard back."
 *
 * `outcome` arrives as an unvalidated string because it comes from a form post.
 * It is checked against the domain enum here, at the boundary, before anything
 * reaches the repository.
 */

export interface UpdateApplicationOutcomeInput {
  readonly jobId: string;
  readonly outcome: string;
  readonly notes?: string;
}

export interface UpdateApplicationOutcomeDeps {
  readonly repository: ApplicationRepository;
  readonly now: () => Date;
}

export type UpdateApplicationOutcomeResult =
  | { readonly status: 'updated'; readonly application: Application }
  | { readonly status: 'not_applied'; readonly jobId: string }
  | { readonly status: 'invalid_outcome'; readonly outcome: string };

export async function updateApplicationOutcome(
  input: UpdateApplicationOutcomeInput,
  deps: UpdateApplicationOutcomeDeps,
): Promise<UpdateApplicationOutcomeResult> {
  if (!isApplicationOutcome(input.outcome)) {
    return { status: 'invalid_outcome', outcome: input.outcome };
  }

  const updated = await deps.repository.updateOutcome({
    jobId: input.jobId,
    outcome: input.outcome,
    at: deps.now(),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  });

  if (updated === null) {
    return { status: 'not_applied', jobId: input.jobId };
  }

  return { status: 'updated', application: updated };
}
