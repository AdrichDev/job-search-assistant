import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCvLibrary,
  createJsonCvModelRepository,
  type CvModel,
  type CvModelDeps,
  type CvModelRepository,
} from '@job-queue/core';
import { safeDownloadName, servePdf } from '@/server/cv-model-pdf';

const BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), Buffer.alloc(4000, 7), Buffer.from('\n%%EOF\n')]);

let library: string;
let data: string;
let deps: CvModelDeps;
let model: CvModel;

function put(relative: string, content: Buffer | string = BYTES): void {
  const parts = relative.split('/');
  mkdirSync(join(library, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(join(library, ...parts), content);
}

async function register(name: string, relativePath: string): Promise<CvModel> {
  const added = await deps.repository.add({ name, kind: 'cv', language: 'es', tags: [], relativePath });
  if (added.status !== 'added') throw new Error('setup');
  return added.model;
}

beforeEach(async () => {
  library = await mkdtemp(join(tmpdir(), 'web-pdf-lib-'));
  data = await mkdtemp(join(tmpdir(), 'web-pdf-data-'));
  put('CV Inglés/Carta Ñandú_.PDF');
  deps = {
    repository: createJsonCvModelRepository({ filePath: join(data, 'cv-models.json') }),
    library: createCvLibrary({ root: library }),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
  model = await register('Carta ñandú — versión 1', 'CV Inglés/Carta Ñandú_.PDF');
});

afterEach(async () => {
  await rm(library, { recursive: true, force: true });
  await rm(data, { recursive: true, force: true });
});

async function bodyOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe('servePdf', () => {
  it('answers 200 with the exact bytes and the safe headers', async () => {
    const response = await servePdf(model.id, 'GET', deps);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-length')).toBe(String(BYTES.length));
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^inline; filename="[A-Za-z0-9._-]+\.pdf"$/);
    expect(Buffer.compare(await bodyOf(response), BYTES)).toBe(0);
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await servePdf(model.id, 'HEAD', deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(BYTES.length));
    expect((await bodyOf(response)).length).toBe(0);
  });

  it('serves the whole file (200) when a Range is requested: the route does not support ranges', async () => {
    // The handler takes no request headers at all: a Range header cannot crash it.
    const response = await servePdf(model.id, 'GET', deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('none');
  });

  it('answers 404 in Spanish for an unknown id, with no path in the body', async () => {
    for (const id of ['nope', '', '../../etc/passwd', '..%2F..%2Fx', 'a'.repeat(5000), 'CON']) {
      const response = await servePdf(id, 'GET', deps);
      expect(response.status, id).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      const text = await response.text();
      expect(text).toMatch(/no se encontr/i);
      expect(text).not.toContain(library);
      expect(text).not.toContain('Ñandú');
    }
  });

  it('never uses the id as a path: an id equal to a real relative path is just unknown', async () => {
    const response = await servePdf('CV Inglés/Carta Ñandú_.PDF', 'GET', deps);
    expect(response.status).toBe(404);
  });

  it('answers 404 when the file was removed, without naming it', async () => {
    await rm(join(library, 'CV Inglés', 'Carta Ñandú_.PDF'));
    const response = await servePdf(model.id, 'GET', deps);
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain(library);
    expect(text).not.toContain('Carta');
  });

  it('answers 404 for a registry entry whose file is empty, oversized or not a PDF', async () => {
    put('empty.pdf', '');
    put('fake.pdf', 'MZ not a pdf');
    put('big.pdf');
    await truncate(join(library, 'big.pdf'), 50 * 1024 * 1024 + 1);
    for (const path of ['empty.pdf', 'fake.pdf', 'big.pdf']) {
      const other = await register(path, path);
      const response = await servePdf(other.id, 'GET', deps);
      expect(response.status, path).toBe(404);
    }
  });

  it('answers 404 (not a crash) for a tampered registry entry', async () => {
    const tampered: CvModelRepository = {
      ...deps.repository,
      find: async () => ({ ...model, relativePath: '../../../Windows/win.pdf' }),
    };
    const response = await servePdf(model.id, 'GET', { ...deps, repository: tampered });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Windows');
  });

  it('answers 503 with a short Spanish text when the registry cannot be read', async () => {
    const broken: CvModelRepository = {
      ...deps.repository,
      find: async () => { throw new Error(`boom ${data}`); },
    };
    const response = await servePdf(model.id, 'GET', { ...deps, repository: broken });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain(data);
    expect(text).not.toMatch(/boom/);
  });
});

describe('safeDownloadName', () => {
  it('produces an ASCII-only file name ending in .pdf', () => {
    expect(safeDownloadName('Carta ñandú — versión 1')).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(safeDownloadName('"quoted"; \r\nHeader: x')).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(safeDownloadName('——')).toBe('modelo.pdf');
    expect(safeDownloadName('x'.repeat(500)).length).toBeLessThanOrEqual(64);
  });
});
