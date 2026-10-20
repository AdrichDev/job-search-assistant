/**
 * A CV or cover-letter MODEL: a PDF the human keeps in their own folder and
 * registers here so applications can later say "I used this one".
 *
 * ## Identity
 *
 * `id` is a random value minted at registration, NOT derived from the path. A
 * model must survive its file being renamed or moved into another category
 * folder; deriving the id from the path would turn every such move into "a
 * model disappeared, another appeared" and orphan whatever points at it.
 *
 * ## Refusals
 *
 * Validation never throws and never echoes the offending value. Reasons are
 * fixed machine codes, so a message built from them cannot leak a path or the
 * content of a cell the person typed.
 */

export const CV_MODEL_KINDS = ['cv', 'letter'] as const;
export type CvModelKind = (typeof CV_MODEL_KINDS)[number];

export const CV_MODEL_LANGUAGES = ['es', 'en'] as const;
export type CvModelLanguage = (typeof CV_MODEL_LANGUAGES)[number];

export const CV_MODEL_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  noteMax: 500,
  maxTags: 12,
  tagMax: 40,
  pathMax: 1024,
} as const;

export interface CvModel {
  readonly id: string;
  readonly name: string;
  readonly kind: CvModelKind;
  readonly language: CvModelLanguage;
  /** Lowercase, trimmed, de-duplicated. */
  readonly tags: readonly string[];
  /** Canonical form: forward slashes, no `.` segments, relative to the library root. */
  readonly relativePath: string;
  readonly registeredAt: Date;
  readonly note?: string;
}

/** What the person provides; the store adds `id` and `registeredAt`. */
export interface CvModelDraft {
  readonly name: string;
  readonly kind: CvModelKind;
  readonly language: CvModelLanguage;
  readonly tags: readonly string[];
  readonly relativePath: string;
  readonly note?: string;
}

/** The editable subset. The path is deliberately absent. `note: null` clears it. */
export interface CvModelPatch {
  readonly name?: string;
  readonly kind?: CvModelKind;
  readonly language?: CvModelLanguage;
  readonly tags?: readonly string[];
  readonly note?: string | null;
}

export type CvModelValidationReason =
  | 'invalid_input'
  | 'invalid_name'
  | 'invalid_kind'
  | 'invalid_language'
  | 'invalid_tags'
  | 'too_many_tags'
  | 'tag_too_long'
  | 'invalid_note'
  | 'invalid_path'
  | 'not_pdf';

export function isCvModelKind(value: unknown): value is CvModelKind {
  return typeof value === 'string' && (CV_MODEL_KINDS as readonly string[]).includes(value);
}

export function isCvModelLanguage(value: unknown): value is CvModelLanguage {
  return typeof value === 'string' && (CV_MODEL_LANGUAGES as readonly string[]).includes(value);
}

/* eslint-disable no-control-regex */
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_LINE_BREAKS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/* eslint-enable no-control-regex */

/** Windows device names open a device, not a file, whatever extension follows. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export type PathCheck =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: 'invalid_path' | 'not_pdf' };

/**
 * Syntactic check of a library-relative path. Pure: it decides what a path LOOKS
 * like. Whether the file exists and stays inside the library is the library
 * adapter's job, because only the filesystem knows about links.
 *
 * Refused outright: non-strings, control characters, `:` anywhere (drive
 * letters, alternate data streams), absolute or UNC forms, any `..` segment,
 * Windows device names, over-long paths, anything not ending in `.pdf`.
 */
export function checkRelativePath(input: unknown): PathCheck {
  const refuse = (reason: 'invalid_path' | 'not_pdf'): PathCheck => ({ ok: false, reason });

  if (typeof input !== 'string') {
    return refuse('invalid_path');
  }
  if (input.length === 0 || input.length > CV_MODEL_LIMITS.pathMax || CONTROL.test(input)) {
    return refuse('invalid_path');
  }
  if (input.includes(':') || input.startsWith('/') || input.startsWith('\\')) {
    return refuse('invalid_path');
  }

  const segments = input.split(/[\\/]/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return refuse('invalid_path');
  }
  // A whitespace-only segment is a different folder on POSIX and an alias of
  // the parent on Windows; there is no honest reading of it.
  if (segments.some((segment) => segment.trim() === '')) {
    return refuse('invalid_path');
  }
  if (segments.some((segment) => RESERVED_DEVICE.test(segment.split('.')[0] ?? ''))) {
    return refuse('invalid_path');
  }

  const last = segments[segments.length - 1] as string;
  if (!last.toLowerCase().endsWith('.pdf') || last.length === '.pdf'.length) {
    return refuse('not_pdf');
  }

  return { ok: true, path: segments.join('/') };
}

/**
 * Identity of a path for duplicate detection. Case-insensitive on every
 * platform: Windows and macOS volumes are, and a Linux library holding two
 * files that differ only by case is a case this product refuses to guess about.
 */
export function relativePathKey(path: string): string {
  return path
    .split(/[\\/]/)
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/')
    .toLowerCase();
}

export type TagsResult =
  | { readonly ok: true; readonly tags: readonly string[] }
  | { readonly ok: false; readonly reason: 'invalid_tags' | 'too_many_tags' | 'tag_too_long' };

/** Free text, trimmed, lowercased, de-duplicated (first occurrence wins), blanks dropped. */
export function normalizeTags(input: unknown): TagsResult {
  if (input === undefined) {
    return { ok: true, tags: [] };
  }
  if (!Array.isArray(input)) {
    return { ok: false, reason: 'invalid_tags' };
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input as unknown[]) {
    if (typeof raw !== 'string' || CONTROL.test(raw)) {
      return { ok: false, reason: 'invalid_tags' };
    }
    const tag = raw.trim().toLowerCase();
    if (tag === '' || seen.has(tag)) {
      continue;
    }
    if (tag.length > CV_MODEL_LIMITS.tagMax) {
      return { ok: false, reason: 'tag_too_long' };
    }
    seen.add(tag);
    tags.push(tag);
  }

  if (tags.length > CV_MODEL_LIMITS.maxTags) {
    return { ok: false, reason: 'too_many_tags' };
  }
  return { ok: true, tags };
}

function checkName(input: unknown): string | null {
  if (typeof input !== 'string' || CONTROL.test(input)) {
    return null;
  }
  const name = input.trim();
  return name.length >= CV_MODEL_LIMITS.nameMin && name.length <= CV_MODEL_LIMITS.nameMax
    ? name
    : null;
}

/** `undefined` = absent, `''` = blank (clear), a string = the note, `null` = refused. */
function checkNote(input: unknown): string | null {
  if (typeof input !== 'string' || CONTROL_EXCEPT_LINE_BREAKS.test(input)) {
    return null;
  }
  const note = input.trim();
  return note.length <= CV_MODEL_LIMITS.noteMax ? note : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type DraftResult =
  | { readonly ok: true; readonly draft: CvModelDraft }
  | { readonly ok: false; readonly reason: CvModelValidationReason };

/** Validates untrusted input into a draft. First failing field wins, in a fixed order. */
export function validateCvModelDraft(input: unknown): DraftResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'invalid_input' };
  }

  const name = checkName(input['name']);
  if (name === null) return { ok: false, reason: 'invalid_name' };
  if (!isCvModelKind(input['kind'])) return { ok: false, reason: 'invalid_kind' };
  if (!isCvModelLanguage(input['language'])) return { ok: false, reason: 'invalid_language' };

  const tags = normalizeTags(input['tags']);
  if (!tags.ok) return tags;

  let note: string | undefined;
  if (input['note'] !== undefined) {
    const checked = checkNote(input['note']);
    if (checked === null) return { ok: false, reason: 'invalid_note' };
    note = checked === '' ? undefined : checked;
  }

  const path = checkRelativePath(input['relativePath']);
  if (!path.ok) return path;

  return {
    ok: true,
    draft: {
      name,
      kind: input['kind'],
      language: input['language'],
      tags: tags.tags,
      relativePath: path.path,
      ...(note === undefined ? {} : { note }),
    },
  };
}

export type PatchResult =
  | { readonly ok: true; readonly patch: CvModelPatch }
  | { readonly ok: false; readonly reason: CvModelValidationReason };

/**
 * Validates an edit. Only the editable fields are read: a `relativePath`, `id`
 * or `registeredAt` in the input is ignored, never applied, so a tampered form
 * cannot repoint a model at another file.
 */
export function validateCvModelPatch(input: unknown): PatchResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'invalid_input' };
  }

  const patch: {
    name?: string;
    kind?: CvModelKind;
    language?: CvModelLanguage;
    tags?: readonly string[];
    note?: string | null;
  } = {};

  if (input['name'] !== undefined) {
    const name = checkName(input['name']);
    if (name === null) return { ok: false, reason: 'invalid_name' };
    patch.name = name;
  }
  if (input['kind'] !== undefined) {
    if (!isCvModelKind(input['kind'])) return { ok: false, reason: 'invalid_kind' };
    patch.kind = input['kind'];
  }
  if (input['language'] !== undefined) {
    if (!isCvModelLanguage(input['language'])) return { ok: false, reason: 'invalid_language' };
    patch.language = input['language'];
  }
  if (input['tags'] !== undefined) {
    const tags = normalizeTags(input['tags']);
    if (!tags.ok) return tags;
    patch.tags = tags.tags;
  }
  if (input['note'] !== undefined) {
    const note = checkNote(input['note']);
    if (note === null) return { ok: false, reason: 'invalid_note' };
    patch.note = note === '' ? null : note;
  }

  return { ok: true, patch };
}

/** Applies a validated patch. Never touches id, path or registration date. */
export function applyCvModelPatch(model: CvModel, patch: CvModelPatch): CvModel {
  const { note: _previousNote, ...rest } = model;
  const note = patch.note === undefined ? model.note : (patch.note ?? undefined);
  return {
    ...rest,
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.kind === undefined ? {} : { kind: patch.kind }),
    ...(patch.language === undefined ? {} : { language: patch.language }),
    ...(patch.tags === undefined ? {} : { tags: patch.tags }),
    ...(note === undefined ? {} : { note }),
  };
}

export function createCvModel(input: {
  readonly id: string;
  readonly registeredAt: Date;
  readonly draft: CvModelDraft;
}): CvModel {
  const { draft } = input;
  return {
    id: input.id,
    name: draft.name,
    kind: draft.kind,
    language: draft.language,
    tags: draft.tags,
    relativePath: draft.relativePath,
    registeredAt: input.registeredAt,
    ...(draft.note === undefined ? {} : { note: draft.note }),
  };
}
