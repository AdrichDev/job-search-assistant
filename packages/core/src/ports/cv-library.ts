/**
 * Driven port for the folder that holds the human's CV and letter PDFs.
 *
 * READ-ONLY by construction: there is no method here that creates, renames or
 * deletes anything, and none may be added. The folder is the user's own
 * (they authorised listing and reading PDFs from it, never writing).
 */

/** Largest file the app will serve as a model. */
export const MAX_MODEL_FILE_BYTES = 50 * 1024 * 1024;

export type ModelFileRefusalReason =
  | 'invalid_path'
  | 'not_pdf'
  | 'outside_library'
  | 'not_found'
  | 'not_a_file'
  | 'empty_file'
  | 'too_large'
  | 'unreadable'
  | 'library_unavailable';

export type ResolveModelFileResult =
  | { readonly status: 'ok'; readonly absolutePath: string; readonly size: number }
  | { readonly status: 'refused'; readonly reason: ModelFileRefusalReason };

export type ReadModelFileResult =
  | { readonly status: 'ok'; readonly bytes: Buffer }
  | { readonly status: 'refused'; readonly reason: ModelFileRefusalReason };

export interface ListCandidateOptions {
  /** Directory levels below the root that are searched. Default 4. */
  readonly maxDepth?: number;
  /** Most PDFs returned. Default 500. */
  readonly maxEntries?: number;
}

export type ListCandidatesResult =
  | {
      readonly status: 'ok';
      /** Library-relative, forward slashes, only `.pdf` files. */
      readonly paths: readonly string[];
      readonly truncated: boolean;
    }
  | { readonly status: 'unavailable' };

export interface CvLibrary {
  /**
   * The absolute path of a model file ONLY when it is safe to open: relative,
   * inside the library after links are resolved, an existing regular `.pdf`
   * file of 1 byte up to the size limit. Anything else is a typed refusal that
   * never carries a path.
   */
  resolveModelFile(relativePath: string): Promise<ResolveModelFileResult>;
  /** Resolves, then reads. Also refuses a file that does not start with `%PDF-`. */
  readModelFile(relativePath: string): Promise<ReadModelFileResult>;
  /** `.pdf` files only; never names, stats or follows anything else. */
  listCandidatePdfs(options?: ListCandidateOptions): Promise<ListCandidatesResult>;
}
