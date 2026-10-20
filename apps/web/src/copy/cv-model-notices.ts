/**
 * Stable codes for every outcome of the CV model library that the person can
 * be told about.
 *
 * Codes, not sentences, because they travel in the URL (`/modelos?aviso=...`)
 * after a form post: the page looks the code up in a closed set and prints the
 * Spanish sentence from `ES.models.notices`. Arbitrary text in the query string
 * is therefore never echoed, and no error message, path or cell content can
 * reach the screen through it.
 *
 * Client-safe on purpose (no `server-only`, no runtime core import): the copy
 * module reads it and the copy module is loaded by client components.
 */
export const CV_MODEL_NOTICE_CODES = [
  /* Successes */
  'registered',
  'updated',
  'removed',
  /* Refusals of the form */
  'invalid_input',
  'invalid_name',
  'invalid_kind',
  'invalid_language',
  'invalid_tags',
  'too_many_tags',
  'tag_too_long',
  'invalid_note',
  'invalid_path',
  'not_pdf',
  'already_registered',
  /* The file cannot be served */
  'outside_library',
  'file_not_found',
  'not_a_file',
  'empty_file',
  'too_large',
  'unreadable',
  /* Everything else */
  'model_not_found',
  'library_unavailable',
  'registry_unavailable',
] as const;

export type CvModelNoticeCode = (typeof CV_MODEL_NOTICE_CODES)[number];

export function isCvModelNoticeCode(value: unknown): value is CvModelNoticeCode {
  return typeof value === 'string' && (CV_MODEL_NOTICE_CODES as readonly string[]).includes(value);
}

/** Successful codes render as a confirmation, the rest as a problem. */
export function isCvModelSuccessCode(code: CvModelNoticeCode): boolean {
  return code === 'registered' || code === 'updated' || code === 'removed';
}
