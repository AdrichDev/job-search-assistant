import {
  relativePathKey,
  validateCvModelDraft,
  validateCvModelPatch,
  type CvModel,
  type CvModelValidationReason,
} from '../domain/cv-model.js';
import type { CvLibrary, ModelFileRefusalReason } from '../ports/cv-library.js';
import type { CvModelRepository } from '../ports/cv-model-repository.js';
import type { Logger } from '../ports/logger.js';

/**
 * Use cases of the CV model library.
 *
 * Expected refusals are returned as typed statuses, never thrown, and carry only
 * a fixed machine reason: no path, no cell content. An UNEXPECTED failure of the
 * registry (a corrupt file, a full disk) becomes `registry_unavailable`; the
 * technical detail goes to the logger, never into the result, because the raw
 * error names the absolute path of a personal file.
 */

export interface CvModelDeps {
  readonly repository: CvModelRepository;
  readonly library: CvLibrary;
  readonly logger?: Logger;
}

export type CvModelRefusalReason =
  | CvModelValidationReason
  | ModelFileRefusalReason
  | 'already_registered';

export type RegisterCvModelResult =
  | { readonly status: 'registered'; readonly model: CvModel }
  | { readonly status: 'refused'; readonly reason: CvModelRefusalReason }
  | { readonly status: 'registry_unavailable' };

export type UpdateCvModelOutcome =
  | { readonly status: 'updated'; readonly model: CvModel }
  | { readonly status: 'not_found' }
  | { readonly status: 'refused'; readonly reason: CvModelValidationReason }
  | { readonly status: 'registry_unavailable' };

export type RemoveCvModelResult =
  | { readonly status: 'removed' }
  | { readonly status: 'not_found' }
  | { readonly status: 'registry_unavailable' };

export interface ListedCvModel {
  readonly model: CvModel;
  /** The file currently resolves safely. False = moved, deleted or unsafe. */
  readonly available: boolean;
}

export type ListCvModelsResult =
  | { readonly status: 'ok'; readonly models: readonly ListedCvModel[] }
  | { readonly status: 'registry_unavailable' };

export type ListCandidatesOutcome =
  | {
      readonly status: 'ok';
      readonly candidates: readonly string[];
      readonly truncated: boolean;
    }
  | { readonly status: 'library_unavailable' }
  | { readonly status: 'registry_unavailable' };

function logFailure(deps: CvModelDeps, operation: string, cause: unknown): void {
  const detail = cause instanceof Error ? cause.message : String(cause);
  deps.logger?.error(`CV model registry: ${operation} failed: ${detail}`);
}

export async function registerCvModel(
  input: unknown,
  deps: CvModelDeps,
): Promise<RegisterCvModelResult> {
  const validated = validateCvModelDraft(input);
  if (!validated.ok) {
    return { status: 'refused', reason: validated.reason };
  }

  // The file must be safe to serve NOW; the allow-list is only as good as this check.
  const file = await deps.library.resolveModelFile(validated.draft.relativePath);
  if (file.status === 'refused') {
    return { status: 'refused', reason: file.reason };
  }

  try {
    const added = await deps.repository.add(validated.draft);
    return added.status === 'added'
      ? { status: 'registered', model: added.model }
      : { status: 'refused', reason: 'already_registered' };
  } catch (cause) {
    logFailure(deps, 'register', cause);
    return { status: 'registry_unavailable' };
  }
}

function usableId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 200;
}

export async function updateCvModel(
  id: unknown,
  input: unknown,
  deps: CvModelDeps,
): Promise<UpdateCvModelOutcome> {
  if (!usableId(id)) {
    return { status: 'not_found' };
  }

  const validated = validateCvModelPatch(input);
  if (!validated.ok) {
    return { status: 'refused', reason: validated.reason };
  }
  if (Object.keys(validated.patch).length === 0) {
    return { status: 'refused', reason: 'invalid_input' };
  }

  try {
    return await deps.repository.update(id, validated.patch);
  } catch (cause) {
    logFailure(deps, 'update', cause);
    return { status: 'registry_unavailable' };
  }
}

/** Removes the registry entry only. The file is never touched. */
export async function removeCvModel(
  id: unknown,
  deps: CvModelDeps,
): Promise<RemoveCvModelResult> {
  if (!usableId(id)) {
    return { status: 'not_found' };
  }

  try {
    return (await deps.repository.remove(id)) ? { status: 'removed' } : { status: 'not_found' };
  } catch (cause) {
    logFailure(deps, 'remove', cause);
    return { status: 'registry_unavailable' };
  }
}

export async function listCvModels(deps: CvModelDeps): Promise<ListCvModelsResult> {
  let models: readonly CvModel[];
  try {
    models = await deps.repository.list();
  } catch (cause) {
    logFailure(deps, 'list', cause);
    return { status: 'registry_unavailable' };
  }

  const listed = await Promise.all(
    models.map(async (model): Promise<ListedCvModel> => {
      const file = await deps.library.resolveModelFile(model.relativePath);
      return { model, available: file.status === 'ok' };
    }),
  );
  return { status: 'ok', models: listed };
}

/** Candidate PDFs in the library that are not registered yet. */
export async function listRegistrableCandidates(
  deps: CvModelDeps,
): Promise<ListCandidatesOutcome> {
  let models: readonly CvModel[];
  try {
    models = await deps.repository.list();
  } catch (cause) {
    logFailure(deps, 'list candidates', cause);
    return { status: 'registry_unavailable' };
  }

  const listing = await deps.library.listCandidatePdfs();
  if (listing.status === 'unavailable') {
    return { status: 'library_unavailable' };
  }

  const registered = new Set(models.map((model) => relativePathKey(model.relativePath)));
  return {
    status: 'ok',
    candidates: listing.paths.filter((path) => !registered.has(relativePathKey(path))),
    truncated: listing.truncated,
  };
}
