import 'server-only';

import {
  listCvModels,
  listRegistrableCandidates,
  registerCvModel,
  removeCvModel,
  updateCvModel,
  type CvModelDeps,
  type ListedCvModel,
} from '@job-queue/core';
import type { CvModelNoticeCode } from '@/copy/cv-model-notices';

/**
 * Web-facing layer of the CV model library: turns an untrusted form into core
 * calls and core statuses into the fixed notice codes the page can word in
 * Spanish. Free of Next.js imports so it is unit-testable.
 *
 * Nothing returned from here carries an error message, a path or a cell value.
 */

export interface ModelActionOutcome {
  readonly ok: boolean;
  readonly code: CvModelNoticeCode;
}

/** Longest raw tags text worth parsing: 12 tags of 40 characters plus separators, with slack. */
const MAX_TAGS_INPUT = 1000;

/** Reads a field as a string; anything else (a file, a missing field) is `undefined`. */
function field(input: unknown, name: string): string | undefined {
  if (typeof input !== 'object' || input === null || typeof (input as FormData).get !== 'function') {
    return undefined;
  }
  const value = (input as FormData).get(name);
  return typeof value === 'string' ? value : undefined;
}

function isFormLike(input: unknown): boolean {
  return typeof input === 'object' && input !== null && typeof (input as FormData).get === 'function';
}

export function parseTagsInput(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** Prefill for the name field: the file name without its extension. */
export function suggestModelName(relativePath: string): string {
  return lastSegment(relativePath).replace(/\.pdf$/i, '').slice(0, 120);
}

/** Prefill for the tags field: the folders the file sits in. The person can edit them. */
export function suggestTags(relativePath: string): string[] {
  const folders = relativePath.split(/[\\/]/).filter(Boolean).slice(0, -1);
  return folders
    .map((folder) => folder.replace(/[_\s]+$/g, '').trim().toLowerCase())
    .filter((folder) => folder.length > 0 && folder.length <= 40);
}

const REFUSAL_CODES: Readonly<Record<string, CvModelNoticeCode>> = {
  invalid_input: 'invalid_input',
  invalid_name: 'invalid_name',
  invalid_kind: 'invalid_kind',
  invalid_language: 'invalid_language',
  invalid_tags: 'invalid_tags',
  too_many_tags: 'too_many_tags',
  tag_too_long: 'tag_too_long',
  invalid_note: 'invalid_note',
  invalid_path: 'invalid_path',
  not_pdf: 'not_pdf',
  already_registered: 'already_registered',
  outside_library: 'outside_library',
  not_found: 'file_not_found',
  not_a_file: 'not_a_file',
  empty_file: 'empty_file',
  too_large: 'too_large',
  unreadable: 'unreadable',
  library_unavailable: 'library_unavailable',
};

function refusalCode(reason: string): CvModelNoticeCode {
  return REFUSAL_CODES[reason] ?? 'invalid_input';
}

function tagsFrom(input: unknown): unknown {
  const raw = field(input, 'tags');
  if (raw === undefined) return [];
  // Over-long raw text is refused as a whole instead of being split into thousands of pieces.
  return raw.length > MAX_TAGS_INPUT ? 'too-long' : parseTagsInput(raw);
}

export async function registerCvModelFromForm(
  input: unknown,
  deps: CvModelDeps,
): Promise<ModelActionOutcome> {
  if (!isFormLike(input)) {
    return { ok: false, code: 'invalid_input' };
  }

  const result = await registerCvModel(
    {
      name: field(input, 'name'),
      kind: field(input, 'kind'),
      language: field(input, 'language'),
      tags: tagsFrom(input),
      note: field(input, 'note'),
      relativePath: field(input, 'relativePath'),
    },
    deps,
  );

  switch (result.status) {
    case 'registered':
      return { ok: true, code: 'registered' };
    case 'refused':
      return { ok: false, code: refusalCode(result.reason) };
    case 'registry_unavailable':
      return { ok: false, code: 'registry_unavailable' };
  }
}

export async function updateCvModelFromForm(
  input: unknown,
  deps: CvModelDeps,
): Promise<ModelActionOutcome> {
  if (!isFormLike(input)) {
    return { ok: false, code: 'invalid_input' };
  }

  // Only editable fields are forwarded. A `relativePath` in the form is never read.
  const result = await updateCvModel(
    field(input, 'id'),
    {
      name: field(input, 'name') ?? '',
      kind: field(input, 'kind'),
      language: field(input, 'language'),
      tags: tagsFrom(input),
      note: field(input, 'note') ?? '',
    },
    deps,
  );

  switch (result.status) {
    case 'updated':
      return { ok: true, code: 'updated' };
    case 'not_found':
      return { ok: false, code: 'model_not_found' };
    case 'refused':
      return { ok: false, code: refusalCode(result.reason) };
    case 'registry_unavailable':
      return { ok: false, code: 'registry_unavailable' };
  }
}

export async function removeCvModelFromForm(
  input: unknown,
  deps: CvModelDeps,
): Promise<ModelActionOutcome> {
  const result = await removeCvModel(field(input, 'id'), deps);
  switch (result.status) {
    case 'removed':
      return { ok: true, code: 'removed' };
    case 'not_found':
      return { ok: false, code: 'model_not_found' };
    case 'registry_unavailable':
      return { ok: false, code: 'registry_unavailable' };
  }
}

export interface ModelsPageData {
  readonly models: readonly ListedCvModel[];
  readonly candidates: readonly string[];
  readonly candidatesTruncated: boolean;
  /** Fixed codes of what could not be read; the page words them in Spanish. */
  readonly warnings: readonly CvModelNoticeCode[];
}

/** Everything `/modelos` shows. Never throws: a failing read becomes a warning code. */
export async function loadModelsPage(deps: CvModelDeps): Promise<ModelsPageData> {
  const warnings: CvModelNoticeCode[] = [];

  const listing = await listCvModels(deps);
  const models = listing.status === 'ok' ? listing.models : [];
  if (listing.status !== 'ok') {
    warnings.push('registry_unavailable');
  }

  let candidates: readonly string[] = [];
  let candidatesTruncated = false;
  if (listing.status === 'ok') {
    const found = await listRegistrableCandidates(deps);
    if (found.status === 'ok') {
      candidates = found.candidates;
      candidatesTruncated = found.truncated;
    } else {
      warnings.push(found.status);
    }
  }

  return { models, candidates, candidatesTruncated, warnings };
}
