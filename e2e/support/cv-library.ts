import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { SCRATCH_CV_LIBRARY_DIR, SCRATCH_CV_MODELS_PATH, SCRATCH_ROOT } from './workspace.js';

/**
 * The CV model library, as the browser suite sees it.
 *
 * Every function here writes ONLY inside the scratch tree (checked by
 * `inScratch`), and the library it builds holds synthetic PDFs: the user's real
 * folder is never read, listed or touched by a spec.
 *
 * The scratch library is built to look like a real one on purpose, because
 * synthetic-only fixtures missed real-file defects before: an accented, spaced
 * folder with a trailing underscore, a mixed-case `.PDF`, and files that are not
 * PDFs sitting next to the PDFs.
 */

/** A PDF in the library root. */
export const LIBRARY_ROOT_PDF = 'Modelo Base.pdf';
/** A PDF in a subfolder with spaces, accents and a trailing underscore, with `.PDF`. */
export const LIBRARY_NESTED_PDF = 'CV Inglés_/Carta Ñandú.PDF';
/** Files that must never be listed or offered. */
export const LIBRARY_NOISE_FILES = ['foto personal.jpg', 'certificado.txt', 'CV Inglés_/notas.docx'];

function inScratch(path: string): string {
  const resolved = resolve(path);
  if (!resolved.startsWith(`${SCRATCH_ROOT}${sep}`)) {
    throw new Error(`Refusing to touch a path outside the scratch tree: ${resolved}`);
  }
  return resolved;
}

/** Smallest well-formed PDF (valid xref), made unique by `label`. Synthetic. */
export function tinyPdf(label: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>',
  ];
  let body = `%PDF-1.4\n%synthetic test file: ${label}\n`;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** The exact bytes the suite put at a library path, for byte-for-byte comparison. */
export const LIBRARY_PDF_BYTES: Readonly<Record<string, Buffer>> = {
  [LIBRARY_ROOT_PDF]: tinyPdf('root'),
  [LIBRARY_NESTED_PDF]: tinyPdf('nested'),
};

export function scratchLibraryPath(relative: string): string {
  return inScratch(resolve(SCRATCH_CV_LIBRARY_DIR, ...relative.split('/')));
}

async function writeLibraryFile(relative: string, content: Buffer | string): Promise<void> {
  const target = scratchLibraryPath(relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

/**
 * Recreates the scratch library (two synthetic PDFs plus non-PDF noise) and
 * removes the registry, so a spec measures its own run.
 */
export async function resetCvModels(): Promise<void> {
  await rm(inScratch(SCRATCH_CV_LIBRARY_DIR), { recursive: true, force: true });
  await rm(inScratch(SCRATCH_CV_MODELS_PATH), { force: true });
  for (const [relative, bytes] of Object.entries(LIBRARY_PDF_BYTES)) {
    await writeLibraryFile(relative, bytes);
  }
  for (const relative of LIBRARY_NOISE_FILES) {
    await writeLibraryFile(relative, 'not a pdf');
  }
}

/** Adds an extra synthetic file to the scratch library (e.g. a tampered or empty one). */
export async function putScratchLibraryFile(relative: string, content: Buffer | string): Promise<void> {
  await writeLibraryFile(relative, content);
}

/** Removes one file from the scratch library, simulating the user moving it away. */
export async function removeScratchLibraryFile(relative: string): Promise<void> {
  await rm(scratchLibraryPath(relative), { force: true });
}

export async function scratchLibraryHas(relative: string): Promise<boolean> {
  try {
    await access(scratchLibraryPath(relative));
    return true;
  } catch {
    return false;
  }
}

/** A recursive "name|size" listing, for before/after comparison of a directory. */
export async function listDirectory(directory: string): Promise<readonly string[] | null> {
  const lines: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        await walk(full, `${prefix}${entry.name}/`);
      } else {
        lines.push(`${prefix}${entry.name}|${(await stat(full)).size}`);
      }
    }
  }
  try {
    await walk(directory, '');
  } catch {
    return null;
  }
  return lines;
}

/** One registry entry as stored (ISO date), read back without going through the app. */
export interface RecordedCvModel {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly language: string;
  readonly tags: readonly string[];
  readonly relativePath: string;
  readonly registeredAt: string;
  readonly note?: string;
}

/**
 * Reads back what the SERVER wrote to the registry. "The table shows a row" and
 * "a model was durably registered" are two claims; only the second survives a
 * restart. A missing file is an empty registry.
 */
export async function readCvModels(): Promise<readonly RecordedCvModel[]> {
  try {
    const raw = await readFile(inScratch(SCRATCH_CV_MODELS_PATH), 'utf8');
    const list = (JSON.parse(raw) as { models?: unknown }).models;
    return Array.isArray(list) ? (list as RecordedCvModel[]) : [];
  } catch {
    return [];
  }
}

export interface SeedCvModel {
  readonly id: string;
  readonly name: string;
  readonly kind?: string;
  readonly language?: string;
  readonly tags?: readonly string[];
  readonly relativePath: string;
  readonly registeredAt?: string;
  readonly note?: string;
}

/** Writes models INTO THE ISOLATED registry, replacing its content. Scratch tree only. */
export async function seedCvModels(rows: readonly SeedCvModel[]): Promise<void> {
  const target = inScratch(SCRATCH_CV_MODELS_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify(
      {
        version: 1,
        models: rows.map((row) => ({
          kind: 'cv',
          language: 'es',
          tags: [],
          registeredAt: '2026-05-01T10:00:00.000Z',
          ...row,
        })),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

/** Overwrites the isolated registry with exact text (e.g. a corrupt file). Scratch tree only. */
export async function writeCvModelsFile(content: string): Promise<void> {
  const target = inScratch(SCRATCH_CV_MODELS_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}
