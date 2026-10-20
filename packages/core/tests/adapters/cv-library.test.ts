import { mkdir, rm, stat, symlink, truncate } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCvLibrary } from '../../src/adapters/library/cv-library.js';
import { MAX_MODEL_FILE_BYTES } from '../../src/ports/cv-library.js';
import { TINY_PDF, makeTempDir, putFile, snapshotTree } from '../helpers/pdf-fixtures.js';

let root: string;
let outside: string;

beforeEach(async () => {
  root = await makeTempDir('cv-lib-root-');
  outside = await makeTempDir('cv-lib-outside-');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('environment', () => {
  it('uses real temp directories that are not under the workspace', () => {
    expect(resolve(root).toLowerCase()).not.toContain('job-search-assistant');
    expect(resolve(outside)).not.toBe(resolve(root));
  });
});

describe('resolveModelFile', () => {
  it('resolves a plain PDF, with accents, spaces, a trailing-underscore folder and .PDF', async () => {
    await putFile(root, 'CV Inglés/Carta Ñandú.PDF');
    await putFile(root, 'carpeta_/x y.pdf');
    await putFile(root, 'raíz.pdf');
    const library = createCvLibrary({ root });

    for (const path of [
      'CV Inglés/Carta Ñandú.PDF',
      'CV Inglés\\Carta Ñandú.PDF',
      'carpeta_/x y.pdf',
      'raíz.pdf',
    ]) {
      const result = await library.resolveModelFile(path);
      expect(result.status, path).toBe('ok');
      if (result.status === 'ok') {
        expect(result.size).toBe(TINY_PDF.length);
      }
    }
  });

  it.each([
    ['../x.pdf', 'invalid_path'],
    ['..\\x.pdf', 'invalid_path'],
    ['a/../../x.pdf', 'invalid_path'],
    ['/etc/passwd.pdf', 'invalid_path'],
    ['C:\\Windows\\x.pdf', 'invalid_path'],
    ['\\\\srv\\share\\x.pdf', 'invalid_path'],
    ['//srv/share/x.pdf', 'invalid_path'],
    ['\\x.pdf', 'invalid_path'],
    [`a${String.fromCharCode(0)}.pdf`, 'invalid_path'],
    [`a${String.fromCharCode(31)}.pdf`, 'invalid_path'],
    ['a.pdf.exe', 'not_pdf'],
    ['noext', 'not_pdf'],
    ['missing.pdf', 'not_found'],
  ])('refuses %j as %s', async (path, reason) => {
    await putFile(root, 'a.pdf.exe', 'MZ');
    await putFile(root, 'noext', TINY_PDF);
    const library = createCvLibrary({ root });
    expect(await library.resolveModelFile(path)).toEqual({ status: 'refused', reason });
  });

  it('refuses an absolute path that points at a real file outside the root', async () => {
    const target = await putFile(outside, 'secret.pdf');
    const library = createCvLibrary({ root });
    expect(await library.resolveModelFile(target)).toEqual({
      status: 'refused',
      reason: 'invalid_path',
    });
  });

  it('refuses a directory (even one named like a PDF), an empty file and an oversized one', async () => {
    await mkdir(join(root, 'folder.pdf'));
    await putFile(root, 'empty.pdf', '');
    const big = await putFile(root, 'big.pdf', TINY_PDF);
    await truncate(big, MAX_MODEL_FILE_BYTES + 1);
    const limit = await putFile(root, 'limit.pdf', TINY_PDF);
    await truncate(limit, MAX_MODEL_FILE_BYTES);
    const library = createCvLibrary({ root });

    expect(await library.resolveModelFile('folder.pdf')).toEqual({
      status: 'refused',
      reason: 'not_a_file',
    });
    expect(await library.resolveModelFile('empty.pdf')).toEqual({
      status: 'refused',
      reason: 'empty_file',
    });
    expect(await library.resolveModelFile('big.pdf')).toEqual({
      status: 'refused',
      reason: 'too_large',
    });
    expect((await library.resolveModelFile('limit.pdf')).status).toBe('ok');
  });

  it('honours a smaller injected size limit', async () => {
    await putFile(root, 'a.pdf');
    const library = createCvLibrary({ root, maxFileBytes: 4 });
    expect(await library.resolveModelFile('a.pdf')).toEqual({
      status: 'refused',
      reason: 'too_large',
    });
  });

  it('reports an unusable root as library_unavailable', async () => {
    const library = createCvLibrary({ root: join(root, 'does-not-exist') });
    expect(await library.resolveModelFile('a.pdf')).toEqual({
      status: 'refused',
      reason: 'library_unavailable',
    });
    expect(await library.listCandidatePdfs()).toEqual({ status: 'unavailable' });
  });

  it('refuses a file symlink or junction that escapes the root (skips only on EPERM)', async () => {
    const secret = await putFile(outside, 'secret.pdf');
    let fileLinked = true;
    let dirLinked = true;
    try {
      await symlink(secret, join(root, 'link.pdf'), 'file');
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'EPERM') throw cause;
      fileLinked = false;
    }
    try {
      await symlink(outside, join(root, 'dirlink'), 'junction');
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'EPERM') throw cause;
      dirLinked = false;
    }
    const library = createCvLibrary({ root });
    if (fileLinked) {
      expect(await library.resolveModelFile('link.pdf')).toEqual({
        status: 'refused',
        reason: 'outside_library',
      });
    }
    if (dirLinked) {
      expect(await library.resolveModelFile('dirlink/secret.pdf')).toEqual({
        status: 'refused',
        reason: 'outside_library',
      });
    }
  });

  it('refuses a symlink inside the root whose target is not a PDF', async () => {
    await putFile(root, 'notes.txt', 'hello');
    try {
      await symlink(join(root, 'notes.txt'), join(root, 'sneaky.pdf'), 'file');
    } catch (cause) {
      if ((cause as { code?: string }).code === 'EPERM') return;
      throw cause;
    }
    const library = createCvLibrary({ root });
    expect(await library.resolveModelFile('sneaky.pdf')).toEqual({
      status: 'refused',
      reason: 'not_pdf',
    });
  });
});

describe('readModelFile', () => {
  it('returns the exact bytes of a safe PDF', async () => {
    await putFile(root, 'sub dir/á.pdf');
    const library = createCvLibrary({ root });
    const result = await library.readModelFile('sub dir/á.pdf');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(Buffer.compare(result.bytes, TINY_PDF)).toBe(0);
    }
  });

  it('refuses a file that does not start like a PDF', async () => {
    await putFile(root, 'fake.pdf', 'MZ not a pdf');
    const library = createCvLibrary({ root });
    expect(await library.readModelFile('fake.pdf')).toEqual({
      status: 'refused',
      reason: 'not_pdf',
    });
  });

  it('refuses unsafe paths without reading', async () => {
    await putFile(outside, 'secret.pdf');
    const library = createCvLibrary({ root });
    expect(await library.readModelFile('../x.pdf')).toEqual({
      status: 'refused',
      reason: 'invalid_path',
    });
  });
});

describe('listCandidatePdfs', () => {
  it('lists only .pdf files (any case), with accents and spaces, using forward slashes', async () => {
    await putFile(root, 'CV Inglés/Cover Letter.pdf');
    await putFile(root, 'raíz.PDF');
    await putFile(root, 'carpeta_/b.pdf');
    await putFile(root, 'foto.jpg', 'x');
    await putFile(root, 'cert.docx', 'x');
    await putFile(root, 'script.ps1', 'x');
    await putFile(root, 'a.pdf.exe', 'x');
    await putFile(root, 'CV Inglés/notes.txt', 'x');
    const library = createCvLibrary({ root });

    const result = await library.listCandidatePdfs();
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect([...result.paths].sort()).toEqual(
        ['CV Inglés/Cover Letter.pdf', 'carpeta_/b.pdf', 'raíz.PDF'].sort(),
      );
      expect(result.truncated).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/foto|cert|script|notes|exe/);
    }
  });

  it('skips tmp, node_modules, .git and dot directories', async () => {
    for (const dir of ['tmp', 'node_modules', '.git', '.hidden']) {
      await putFile(root, `${dir}/x.pdf`);
    }
    await putFile(root, 'ok/y.pdf');
    const result = await createCvLibrary({ root }).listCandidatePdfs();
    expect(result).toEqual({ status: 'ok', paths: ['ok/y.pdf'], truncated: false });
  });

  it('respects maxDepth', async () => {
    await putFile(root, 'a/b/c/d/e/deep.pdf');
    await putFile(root, 'a/b/c/d/ok.pdf');
    const result = await createCvLibrary({ root }).listCandidatePdfs({ maxDepth: 4 });
    expect(result).toEqual({ status: 'ok', paths: ['a/b/c/d/ok.pdf'], truncated: false });
  });

  it('caps entries and says so', async () => {
    for (let i = 0; i < 7; i += 1) {
      await putFile(root, `f${i}.pdf`);
    }
    const capped = await createCvLibrary({ root }).listCandidatePdfs({ maxEntries: 5 });
    expect(capped.status === 'ok' && capped.paths.length).toBe(5);
    expect(capped.status === 'ok' && capped.truncated).toBe(true);

    const exact = await createCvLibrary({ root }).listCandidatePdfs({ maxEntries: 7 });
    expect(exact.status === 'ok' && exact.truncated).toBe(false);
  });

  it('never follows a symlinked directory', async () => {
    await putFile(outside, 'leak.pdf');
    try {
      await symlink(outside, join(root, 'dirlink'), 'junction');
    } catch (cause) {
      if ((cause as { code?: string }).code === 'EPERM') return;
      throw cause;
    }
    const result = await createCvLibrary({ root }).listCandidatePdfs();
    expect(result).toEqual({ status: 'ok', paths: [], truncated: false });
  });

  it('every listed path resolves through the safe resolver', async () => {
    await putFile(root, 'CV Inglés/Carta.pdf');
    await putFile(root, 'carpeta_/b.PDF');
    const library = createCvLibrary({ root });
    const listing = await library.listCandidatePdfs();
    if (listing.status !== 'ok') throw new Error('unexpected');
    expect(listing.paths).toHaveLength(2);
    for (const path of listing.paths) {
      expect((await library.resolveModelFile(path)).status, path).toBe('ok');
    }
  });
});

describe('read-only guarantee', () => {
  it('leaves the library listing, sizes and mtimes identical after every operation', async () => {
    await putFile(root, 'CV Inglés/Carta.pdf');
    await putFile(root, 'a.pdf');
    await putFile(root, 'notes.txt', 'x');
    await mkdir(join(root, 'empty-dir'));
    await putFile(root, 'fake.pdf', 'nope');
    const before = await snapshotTree(root);
    const library = createCvLibrary({ root });

    await library.listCandidatePdfs();
    await library.listCandidatePdfs({ maxEntries: 1 });
    for (const path of [
      'a.pdf',
      'CV Inglés/Carta.pdf',
      'fake.pdf',
      '../x.pdf',
      'missing.pdf',
      'notes.txt',
      'empty-dir',
    ]) {
      await library.resolveModelFile(path);
      await library.readModelFile(path);
    }

    expect(await snapshotTree(root)).toEqual(before);
    expect((await stat(join(root, 'a.pdf'))).size).toBe(TINY_PDF.length);
  });

  it('the adapter source imports only read-only filesystem functions', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(
      new URL('../../src/adapters/library/cv-library.ts', import.meta.url),
      'utf8',
    );
    const fsImports = [
      ...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'node:fs[^']*'/g),
    ].flatMap((match) =>
      (match[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
    expect(fsImports.sort()).toEqual(['open', 'readdir', 'realpath', 'stat']);
    expect(source).not.toMatch(/from 'node:fs'|require\(|\.write\(|\.writeFile\(/);
  });
});
