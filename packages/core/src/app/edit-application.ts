import {
  ApplicationPatchError,
  applicationsEqual,
  type Application,
  type ApplicationPatch,
  type PatchRefusalReason,
} from '../domain/application.js';
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
}

export interface EditApplicationDeps {
  readonly repository: ApplicationRepository;
  readonly now: () => Date;
}

export type EditApplicationResult =
  | { readonly status: 'updated'; readonly before: Application; readonly after: Application }
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
    return { status: 'updated', before: result.before, after: result.after };
  } catch (cause: unknown) {
    // Only a domain refusal is a result; I/O failures must stay loud.
    if (cause instanceof ApplicationPatchError) {
      return { status: 'invalid', reason: cause.reason };
    }
    throw cause;
  }
}
