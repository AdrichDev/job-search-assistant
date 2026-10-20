import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { checkRelativePath } from '../../domain/cv-model.js';
import {
  MAX_MODEL_FILE_BYTES,
  type CvLibrary,
  type ListCandidateOptions,
  type ListCandidatesResult,
  type ModelFileRefusalReason,
  type ReadModelFileResult,
  type ResolveModelFileResult,
} from '../../ports/cv-library.js';

/**
 * READ-ONLY adapter over the user's own CV folder.
 *
 * Nothing in this module may write, create, rename or delete. Only
 * `readdir`, `realpath`, `stat` and a read-mode `open` are imported, and a test
 * pins that list plus a before/after snapshot of a real directory.
 *
 * Safety is layered because each layer catches what the previous one cannot:
 * the domain rejects hostile SPELLINGS (`..`, drive letters, UNC, control
 * characters, device names); only the filesystem knows about LINKS, so the
 * resolved real path must still sit inside the real path of the root.
 */

export interface CvLibraryOptions {
  readonly root: string;
  /** Override for tests; production uses the 50 MB port constant. */
  readonly maxFileBytes?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 500;
const SKIPPED_DIRECTORIES = new Set(['tmp', 'node_modules', '.git']);
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

function errorCode(cause: unknown): string | undefined {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

function hasPdfExtension(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf');
}

export function createCvLibrary(options: CvLibraryOptions): CvLibrary {
  const root = resolve(options.root);
  const maxBytes = options.maxFileBytes ?? MAX_MODEL_FILE_BYTES;

  async function resolveModelFile(input: string): Promise<ResolveModelFileResult> {
    const refuse = (reason: ModelFileRefusalReason): ResolveModelFileResult => ({
      status: 'refused',
      reason,
    });

    const checked = checkRelativePath(input);
    if (!checked.ok) {
      return refuse(checked.reason);
    }

    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      return refuse('library_unavailable');
    }

    // Lexical containment first (cheap, and independent of the links below).
    const candidate = resolve(realRoot, ...checked.path.split('/'));
    if (!isInside(realRoot, candidate)) {
      return refuse('invalid_path');
    }

    let realFile: string;
    try {
      realFile = await realpath(candidate);
    } catch (cause) {
      const code = errorCode(cause);
      return refuse(code === 'ENOENT' || code === 'ENOTDIR' ? 'not_found' : 'unreadable');
    }

    // Links and junctions are followed by realpath, so an escape shows up here.
    if (!isInside(realRoot, realFile)) {
      return refuse('outside_library');
    }
    // A link named `x.pdf` that points at a non-PDF must not be served as one.
    if (!hasPdfExtension(realFile)) {
      return refuse('not_pdf');
    }

    let info;
    try {
      info = await stat(realFile);
    } catch (cause) {
      return refuse(errorCode(cause) === 'ENOENT' ? 'not_found' : 'unreadable');
    }
    if (!info.isFile()) {
      return refuse('not_a_file');
    }
    if (info.size < 1) {
      return refuse('empty_file');
    }
    if (info.size > maxBytes) {
      return refuse('too_large');
    }

    return { status: 'ok', absolutePath: realFile, size: info.size };
  }

  async function readModelFile(input: string): Promise<ReadModelFileResult> {
    const resolved = await resolveModelFile(input);
    if (resolved.status === 'refused') {
      return resolved;
    }

    let handle;
    try {
      handle = await open(resolved.absolutePath, 'r');
    } catch {
      return { status: 'refused', reason: 'unreadable' };
    }
    try {
      // Re-check on the open handle: the file may have changed since `stat`.
      const info = await handle.stat();
      if (!info.isFile() || info.size < 1) {
        return { status: 'refused', reason: info.isFile() ? 'empty_file' : 'not_a_file' };
      }
      if (info.size > maxBytes) {
        return { status: 'refused', reason: 'too_large' };
      }
      const bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const content = offset === bytes.length ? bytes : bytes.subarray(0, offset);
      if (content.length < PDF_MAGIC.length || !content.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
        return { status: 'refused', reason: 'not_pdf' };
      }
      return { status: 'ok', bytes: content };
    } catch {
      return { status: 'refused', reason: 'unreadable' };
    } finally {
      await handle.close();
    }
  }

  async function listCandidatePdfs(
    listOptions: ListCandidateOptions = {},
  ): Promise<ListCandidatesResult> {
    const maxDepth = listOptions.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxEntries = listOptions.maxEntries ?? DEFAULT_MAX_ENTRIES;

    try {
      await readdir(root);
    } catch {
      return { status: 'unavailable' };
    }

    const paths: string[] = [];
    let truncated = false;

    async function walk(directory: string, prefix: string, depth: number): Promise<void> {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        // An unreadable subfolder is skipped, not fatal.
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (truncated) return;
        const name = entry.name;

        // `isFile`/`isDirectory` on a Dirent describe the entry itself, so a
        // symlink or junction is neither and is never followed or listed.
        if (entry.isFile()) {
          if (!hasPdfExtension(name)) continue;
          if (paths.length >= maxEntries) {
            truncated = true;
            return;
          }
          paths.push(`${prefix}${name}`);
        } else if (entry.isDirectory()) {
          if (depth >= maxDepth || name.startsWith('.') || SKIPPED_DIRECTORIES.has(name.toLowerCase())) {
            continue;
          }
          await walk(`${directory}${sep}${name}`, `${prefix}${name}/`, depth + 1);
        }
      }
    }

    await walk(root, '', 0);
    return { status: 'ok', paths, truncated };
  }

  return { resolveModelFile, readModelFile, listCandidatePdfs };
}
