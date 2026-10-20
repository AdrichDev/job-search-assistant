import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Smallest thing that starts like a PDF. Synthetic: never a real document. */
export const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function putFile(root: string, relative: string, content: Buffer | string = TINY_PDF) {
  const target = join(root, ...relative.split('/'));
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
  return target;
}

/** Every entry under `root` with its size and mtime, for before/after comparison. */
export async function snapshotTree(root: string): Promise<string[]> {
  const lines: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(directory, entry.name);
      const info = await stat(full);
      lines.push(`${prefix}${entry.name}|${entry.isDirectory() ? 'dir' : info.size}|${info.mtimeMs}`);
      if (entry.isDirectory()) {
        await walk(full, `${prefix}${entry.name}/`);
      }
    }
  }
  await walk(root, '');
  return lines;
}
