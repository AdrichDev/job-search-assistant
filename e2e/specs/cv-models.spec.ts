import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import {
  LIBRARY_NESTED_PDF,
  LIBRARY_NOISE_FILES,
  LIBRARY_PDF_BYTES,
  LIBRARY_ROOT_PDF,
  readCvModels,
  removeScratchLibraryFile,
  scratchLibraryHas,
  seedCvModels,
  tinyPdf,
  writeCvModelsFile,
} from '../support/cv-library.js';
import {
  ISOLATION_ENV,
  SCRATCH_CV_LIBRARY_DIR,
  SCRATCH_CV_MODELS_PATH,
  SCRATCH_ROOT,
} from '../support/workspace.js';
import { readFile, rm } from 'node:fs/promises';
import type { Page } from '@playwright/test';

/**
 * The CV model library (CU8, T3a).
 *
 * Everything runs against a SCRATCH library of synthetic PDFs under e2e/.tmp: the
 * user's own folder is never read or listed. The first test proves the server was
 * really pointed at the scratch paths, because every other result here is
 * meaningless if it was not.
 */

const NESTED_ENTRY = `Registrar ${LIBRARY_NESTED_PDF}`;
const ROOT_ENTRY = `Registrar ${LIBRARY_ROOT_PDF}`;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Secciones' });
const candidate = (page: Page, path: string) => page.locator('details').filter({ hasText: path });

async function openCandidate(page: Page, path: string) {
  await page.getByText(`Registrar ${path}`, { exact: true }).click();
  return candidate(page, path);
}

/** Registers one candidate through the real form and waits for the redirect. */
async function registerThroughForm(
  page: Page,
  path: string,
  fields: { name?: string; kind?: string; language?: string; tags?: string; note?: string } = {},
) {
  const entry = candidate(page, path);
  // Open it only when it is still collapsed: clicking the summary again would close it.
  if (!(await entry.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await openCandidate(page, path);
  }
  if (fields.name !== undefined) await entry.getByLabel('Nombre').fill(fields.name);
  if (fields.kind !== undefined) await entry.getByLabel('Tipo').selectOption({ label: fields.kind });
  if (fields.language !== undefined) {
    await entry.getByLabel('Idioma').selectOption({ label: fields.language });
  }
  if (fields.tags !== undefined) await entry.getByLabel(/Etiquetas/).fill(fields.tags);
  if (fields.note !== undefined) await entry.getByLabel(/Nota/).fill(fields.note);
  await entry.getByRole('button', { name: 'Registrar modelo' }).click();
}

test.describe('CV model library', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
  });

  test('the server is pointed at the scratch library and registry, not the user ones', async ({ page }) => {
    expect(ISOLATION_ENV['JOB_QUEUE_CV_LIBRARY_DIR']).toBe(SCRATCH_CV_LIBRARY_DIR);
    expect(ISOLATION_ENV['JOB_QUEUE_CV_MODELS_PATH']).toBe(SCRATCH_CV_MODELS_PATH);
    expect(SCRATCH_CV_LIBRARY_DIR.startsWith(SCRATCH_ROOT)).toBe(true);

    // Behavioural proof: the page offers exactly the synthetic scratch PDFs.
    await page.goto('/modelos');
    await expect(page.getByText(ROOT_ENTRY, { exact: true })).toBeVisible();
    await expect(page.getByText(NESTED_ENTRY, { exact: true })).toBeVisible();
  });

  test('the navigation has a Modelos link that is the current page only on /modelos', async ({ page }) => {
    await page.goto('/');
    await expect(nav(page).getByRole('link', { name: 'Modelos' })).not.toHaveAttribute('aria-current', 'page');
    await expect(nav(page).getByRole('link', { name: 'Ofertas' })).toHaveAttribute('aria-current', 'page');

    await nav(page).getByRole('link', { name: 'Modelos' }).click();
    await expect(page).toHaveURL(/\/modelos$/);
    await expect(nav(page).getByRole('link', { name: 'Modelos' })).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).getByRole('link', { name: 'Ofertas' })).not.toHaveAttribute('aria-current', 'page');
    await expect(nav(page).getByRole('link', { name: 'Seguimiento' })).not.toHaveAttribute('aria-current', 'page');

    await page.goto('/seguimiento');
    await expect(nav(page).getByRole('link', { name: 'Seguimiento' })).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).getByRole('link', { name: 'Modelos' })).not.toHaveAttribute('aria-current', 'page');
  });

  test('shows the empty state and offers only PDFs as candidates', async ({ page }) => {
    await page.goto('/modelos');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Modelos de CV y cartas');
    await expect(page.getByText('Todavía no hay modelos registrados')).toBeVisible();
    await expect(page.getByText('0 modelos registrados')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    const text = await page.getByRole('main').innerText();
    for (const noise of LIBRARY_NOISE_FILES) {
      expect(text, `a non-PDF file was listed: ${noise}`).not.toContain(noise.split('/').pop());
    }
    // The page never prints an absolute path.
    expect(text).not.toContain(SCRATCH_ROOT);
  });

  test('registers a candidate through the form and lists it as available', async ({ page }) => {
    await page.goto('/modelos');
    const entry = await openCandidate(page, LIBRARY_NESTED_PDF);

    // Prefilled from the file name and the folder; both editable.
    await expect(entry.getByLabel('Nombre')).toHaveValue('Carta Ñandú');
    await expect(entry.getByLabel(/Etiquetas/)).toHaveValue('cv inglés');

    await registerThroughForm(page, LIBRARY_NESTED_PDF, {
      name: 'Carta en inglés',
      kind: 'Carta de presentación',
      language: 'Inglés',
      tags: 'Java, Backend, java',
      note: 'Versión base',
    });

    await expect(page).toHaveURL(/aviso=registered/);
    await expect(page.getByRole('status').filter({ hasText: 'Modelo registrado.' })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'Carta en inglés' });
    await expect(row).toContainText('Carta de presentación');
    await expect(row).toContainText('Inglés');
    await expect(row).toContainText('java');
    await expect(row).toContainText('backend');
    await expect(row).toContainText('Disponible');
    await expect(row).toContainText('Versión base');
    await expect(page.getByText('1 modelo registrado')).toBeVisible();

    // Durable, normalised, and the registered PDF is no longer a candidate.
    const stored = await readCvModels();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      name: 'Carta en inglés',
      kind: 'letter',
      language: 'en',
      tags: ['java', 'backend'],
      relativePath: LIBRARY_NESTED_PDF,
      note: 'Versión base',
    });
    await expect(page.getByText(NESTED_ENTRY, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ROOT_ENTRY, { exact: true })).toBeVisible();
  });

  test('opens the PDF through the app: link attributes, bytes and headers', async ({ page }) => {
    await page.goto('/modelos');
    await registerThroughForm(page, LIBRARY_NESTED_PDF, { name: 'Carta Ñandú — v1' });
    await expect(page).toHaveURL(/aviso=registered/);

    const id = await firstModelId();
    const link = page.getByRole('link', { name: /Abrir PDF/ });
    await expect(link).toHaveAttribute('href', `/modelos/${id}/pdf`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);

    const response = await page.request.get(`/modelos/${id}/pdf`);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toBe('application/pdf');
    expect(headers['content-disposition']).toMatch(/^inline; filename="[A-Za-z0-9._-]+\.pdf"$/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('no-store');
    const bytes = await response.body();
    expect(headers['content-length']).toBe(String(bytes.length));
    expect(Buffer.compare(bytes, LIBRARY_PDF_BYTES[LIBRARY_NESTED_PDF] as Buffer)).toBe(0);

    // HEAD and Range must not crash. This route answers a full 200 and says so.
    const head = await page.request.head(`/modelos/${id}/pdf`);
    expect(head.status()).toBe(200);
    expect(head.headers()['content-type']).toBe('application/pdf');
    const ranged = await page.request.get(`/modelos/${id}/pdf`, { headers: { Range: 'bytes=0-9' } });
    expect(ranged.status()).toBe(200);
    expect((await ranged.body()).length).toBe(bytes.length);
    expect(ranged.headers()['accept-ranges']).toBe('none');

    // Writes are not offered.
    expect((await page.request.post(`/modelos/${id}/pdf`)).status()).toBe(405);
  });

  test('the PDF route answers 404 in Spanish, never with a path, for unknown ids and traversal attempts', async ({ page }) => {
    await writeFile(resolve(SCRATCH_ROOT, 'outside.pdf'), tinyPdf('outside'));
    for (const id of ['no-existe', '..%2F..%2Foutside.pdf', '%2e%2e%2foutside.pdf', encodeURIComponent(LIBRARY_ROOT_PDF), '%00']) {
      const response = await page.request.get(`/modelos/${id}/pdf`);
      expect(response.status(), id).toBe(404);
      const text = await response.text();
      expect(text, id).toMatch(/No se encontr/);
      expect(text, id).not.toContain(SCRATCH_ROOT);
      expect(text, id).not.toMatch(/%PDF/);
    }
  });

  test('edits name, tags, kind and language; the path cannot be edited', async ({ page }) => {
    await page.goto('/modelos');
    await registerThroughForm(page, LIBRARY_ROOT_PDF, { name: 'Original', tags: 'java' });
    await expect(page).toHaveURL(/aviso=registered/);

    await page.getByRole('link', { name: /^Editar/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Editar modelo');
    await expect(page.getByLabel('Nombre')).toHaveValue('Original');
    await expect(page.locator('input[name="relativePath"]')).toHaveCount(0);
    await expect(page.getByText(LIBRARY_ROOT_PDF)).toBeVisible();

    await page.getByLabel('Nombre').fill('Renombrado');
    await page.getByLabel(/Etiquetas/).fill('React, Frontend, REACT');
    await page.getByLabel('Idioma').selectOption({ label: 'Inglés' });
    // A tampered form tries to repoint the model; the server must ignore it.
    await page.locator('form').first().evaluate((form) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'relativePath';
      input.value = '../../outside.pdf';
      form.appendChild(input);
    });
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    await expect(page).toHaveURL(/\/modelos\?aviso=updated/);
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados.' })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'Renombrado' });
    await expect(row).toContainText('react');
    await expect(row).toContainText('frontend');
    await expect(row).toContainText('Inglés');

    const [stored] = await readCvModels();
    expect(stored).toMatchObject({
      name: 'Renombrado',
      tags: ['react', 'frontend'],
      language: 'en',
      relativePath: LIBRARY_ROOT_PDF,
    });
  });

  test('an invalid edit is refused with a Spanish message and changes nothing', async ({ page }) => {
    await seedCvModels([{ id: 'm-1', name: 'Uno', relativePath: LIBRARY_ROOT_PDF }]);
    await page.goto('/modelos/m-1/editar');
    await page.getByLabel('Nombre').fill('x'.repeat(130));
    // The input is capped in the browser; remove the cap to send the oversized value.
    await page.getByLabel('Nombre').evaluate((input) => input.removeAttribute('maxlength'));
    await page.getByLabel('Nombre').fill('x'.repeat(130));
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    await expect(page).toHaveURL(/\/modelos\/m-1\/editar\?aviso=invalid_name/);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('El nombre es obligatorio');
    expect((await readCvModels())[0]?.name).toBe('Uno');
  });

  test('removes only the registry entry, after an explicit confirmation; the file stays', async ({ page }) => {
    await page.goto('/modelos');
    await registerThroughForm(page, LIBRARY_ROOT_PDF, { name: 'Para quitar' });
    await expect(page).toHaveURL(/aviso=registered/);

    // Step 1: asking is not removing.
    await page.getByRole('link', { name: /^Quitar del registro/ }).click();
    const confirm = page.getByRole('region', { name: 'Quitar un modelo del registro' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('El archivo PDF no se toca');
    expect(await readCvModels()).toHaveLength(1);

    // Cancelling changes nothing.
    await confirm.getByRole('link', { name: 'Cancelar' }).click();
    await expect(page.getByRole('region', { name: 'Quitar un modelo del registro' })).toHaveCount(0);
    expect(await readCvModels()).toHaveLength(1);

    // Step 2: confirm.
    await page.getByRole('link', { name: /^Quitar del registro/ }).click();
    await page
      .getByRole('region', { name: 'Quitar un modelo del registro' })
      .getByRole('button', { name: 'Sí, quitar del registro' })
      .click();

    await expect(page).toHaveURL(/aviso=removed/);
    await expect(page.getByRole('status').filter({ hasText: 'Modelo quitado del registro' })).toBeVisible();
    expect(await readCvModels()).toHaveLength(0);
    expect(await scratchLibraryHas(LIBRARY_ROOT_PDF)).toBe(true);
    // It is a candidate again.
    await expect(page.getByText(ROOT_ENTRY, { exact: true })).toBeVisible();
  });

  test('a file removed from the library shows as not available and its PDF answers 404', async ({ page }) => {
    await page.goto('/modelos');
    await registerThroughForm(page, LIBRARY_ROOT_PDF, { name: 'Se moverá' });
    await expect(page).toHaveURL(/aviso=registered/);
    const id = await firstModelId();

    await removeScratchLibraryFile(LIBRARY_ROOT_PDF);
    await page.goto('/modelos');

    const row = page.getByRole('row').filter({ hasText: 'Se moverá' });
    await expect(row).toContainText('No disponible');
    await expect(row.getByRole('link', { name: /Abrir PDF/ })).toHaveCount(0);
    await expect(row.getByRole('link', { name: /^Editar/ })).toBeVisible();
    expect((await page.request.get(`/modelos/${id}/pdf`)).status()).toBe(404);
  });

  test('refuses a tampered registration (path with ..) with a Spanish message and registers nothing', async ({ page }) => {
    await writeFile(resolve(SCRATCH_ROOT, 'outside.pdf'), tinyPdf('outside'));
    const attempts: [string, RegExp][] = [
      ['../outside.pdf', /aviso=invalid_path/],
      ['..\\outside.pdf', /aviso=invalid_path/],
      [resolve(SCRATCH_ROOT, 'outside.pdf'), /aviso=invalid_path/],
      ['/etc/passwd.pdf', /aviso=invalid_path/],
      ['\\\\servidor\\recurso\\x.pdf', /aviso=invalid_path/],
      ['certificado.txt', /aviso=not_pdf/],
      ['no-existe.pdf', /aviso=file_not_found/],
    ];

    for (const [tampered, expected] of attempts) {
      await page.goto('/modelos');
      const entry = await openCandidate(page, LIBRARY_ROOT_PDF);
      await entry.locator('input[name="relativePath"]').evaluate((input, value) => {
        (input as HTMLInputElement).value = value;
      }, tampered);
      await entry.getByRole('button', { name: 'Registrar modelo' }).click();

      await expect(page, tampered).toHaveURL(expected);
      const alert = page.getByRole('main').getByRole('alert');
      await expect(alert, tampered).toContainText('No se pudo completar la operación');
      expect(await alert.innerText(), tampered).not.toContain(SCRATCH_ROOT);
      expect(await readCvModels(), tampered).toHaveLength(0);
    }
  });

  test('refuses registering the same file twice', async ({ page }) => {
    await seedCvModels([{ id: 'm-1', name: 'Ya está', relativePath: LIBRARY_NESTED_PDF }]);
    await page.goto('/modelos');
    const entry = await openCandidate(page, LIBRARY_ROOT_PDF);
    await entry.locator('input[name="relativePath"]').evaluate((input, value) => {
      (input as HTMLInputElement).value = value;
    }, LIBRARY_NESTED_PDF);
    await entry.getByRole('button', { name: 'Registrar modelo' }).click();

    await expect(page).toHaveURL(/aviso=already_registered/);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Ese archivo ya está registrado como modelo.');
    expect(await readCvModels()).toHaveLength(1);
  });

  test('refuses too many tags and a too-long tag with specific Spanish messages', async ({ page }) => {
    await page.goto('/modelos');

    // Too many tags.
    await registerThroughForm(page, LIBRARY_ROOT_PDF, {
      tags: Array.from({ length: 13 }, (_, i) => `t${i}`).join(', '),
    });
    await expect(page).toHaveURL(/aviso=too_many_tags/);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('máximo es 12');

    // A tag that is too long.
    await page.goto('/modelos');
    await registerThroughForm(page, LIBRARY_ROOT_PDF, { tags: 'x'.repeat(41) });
    await expect(page).toHaveURL(/aviso=tag_too_long/);

    expect(await readCvModels()).toHaveLength(0);
  });

  test('registration works with the keyboard alone', async ({ page }) => {
    await page.goto('/modelos');

    // Tab to the summary of the nested candidate, open it with Enter.
    const summary = page.getByText(NESTED_ENTRY, { exact: true });
    let reached = false;
    for (let step = 0; step < 60 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await summary.evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the candidate summary was not reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');

    const entry = candidate(page, LIBRARY_NESTED_PDF);
    await expect(entry.getByLabel('Nombre')).toBeVisible();

    // Name, kind, language, tags, note, submit: the natural tab order.
    await page.keyboard.press('Tab');
    await expect(entry.getByLabel('Nombre')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Carta por teclado');
    await page.keyboard.press('Tab');
    await expect(entry.getByLabel('Tipo')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await expect(entry.getByLabel('Idioma')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(entry.getByLabel(/Etiquetas/)).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('teclado, accesible');
    await page.keyboard.press('Tab');
    await expect(entry.getByLabel(/Nota/)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(entry.getByRole('button', { name: 'Registrar modelo' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/aviso=registered/);
    const [stored] = await readCvModels();
    expect(stored).toMatchObject({
      name: 'Carta por teclado',
      kind: 'letter',
      tags: ['teclado', 'accesible'],
      relativePath: LIBRARY_NESTED_PDF,
    });
  });

  test('accessibility: one main, one h1, a captioned table, a skip link and no console errors', async ({ page, console: log }) => {
    await seedCvModels([{ id: 'm-1', name: 'Uno', relativePath: LIBRARY_ROOT_PDF, tags: ['java'] }]);
    await page.goto('/modelos');

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('link').first()).toContainText('Saltar a los modelos');
    await expect(page.locator('table caption')).toHaveCount(1);
    await expect(page.locator('th[scope="col"]')).toHaveCount(6);
    await expect(page.locator('input:not([type="hidden"]), select, textarea')).toHaveCount(await page.locator('label').count());
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Modelos de CV y cartas/);

    // Visible focus on the first action link.
    const open = page.getByRole('link', { name: /Abrir PDF/ });
    await open.focus();
    const style = await open.evaluate((node) => {
      const computed = getComputedStyle(node);
      return { outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow };
    });
    expect(
      (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') || style.boxShadow !== 'none',
      `no visible focus indicator: ${JSON.stringify(style)}`,
    ).toBe(true);

    await page.goto('/modelos/m-1/editar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    const appErrors = log.errors.filter(
      (message) => !/ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource/i.test(message),
    );
    expect(appErrors, `console errors:\n${appErrors.join('\n')}`).toEqual([]);
    expect(log.pageErrors).toEqual([]);
  });

  test('no untranslated English leaks into any of the pages', async ({ page }) => {
    await seedCvModels([{ id: 'm-1', name: 'Uno', relativePath: LIBRARY_ROOT_PDF, tags: ['java'] }]);
    const english = /\b(register|registered|remove|removed|edit|cancel|save|saved|tags|available|unavailable|not found|open pdf|models?|library|invalid|error)\b/i;

    for (const url of [
      '/modelos',
      '/modelos?aviso=registered',
      '/modelos?aviso=invalid_path',
      '/modelos?aviso=registry_unavailable',
      '/modelos?quitar=m-1',
      '/modelos/m-1/editar',
      '/modelos/m-1/editar?aviso=invalid_name',
      '/modelos/nada/editar',
    ]) {
      await page.goto(url);
      const text = await page.getByRole('main').innerText();
      expect(text, `${url}: ${text.match(english)?.[0]}`).not.toMatch(english);
    }
  });

  test('a corrupt registry degrades to a Spanish warning, shows no raw error or path, and is left untouched', async ({ page }) => {
    await writeCvModelsFile('{ this is not json');
    await page.goto('/modelos');

    const warning = page.getByRole('status').filter({ hasText: 'No se pudo leer el registro de modelos' });
    await expect(warning).toBeVisible();
    const text = await page.getByRole('main').innerText();
    for (const leak of [SCRATCH_ROOT, 'cv-models.json', 'SyntaxError', 'Unexpected', 'JSON', 'Refusing']) {
      expect(text, `leaked: ${leak}`).not.toContain(leak);
    }
    // The page still renders and nothing is offered for registration while the registry is unreadable.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await readFile(SCRATCH_CV_MODELS_PATH, 'utf8')).toBe('{ this is not json');

    // The PDF route and the edit page degrade too.
    expect((await page.request.get('/modelos/x/pdf')).status()).toBe(503);
    await page.goto('/modelos/x/editar');
    await expect(page.getByText('No se pudo leer el registro de modelos')).toBeVisible();
  });

  test('a missing library folder degrades to a Spanish warning and marks models as not available', async ({ page }) => {
    await seedCvModels([{ id: 'm-1', name: 'Huérfano', relativePath: LIBRARY_ROOT_PDF }]);
    await rm(SCRATCH_CV_LIBRARY_DIR, { recursive: true, force: true });
    await page.goto('/modelos');

    await expect(page.getByRole('status').filter({ hasText: 'No se puede leer la carpeta de modelos' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Huérfano' })).toContainText('No disponible');
    const text = await page.getByRole('main').innerText();
    expect(text).not.toContain(SCRATCH_ROOT);
    expect(text).not.toMatch(/ENOENT/);
  });

  test('ignores arbitrary text in the notice and removal query parameters', async ({ page }) => {
    await seedCvModels([{ id: 'm-1', name: 'Uno', relativePath: LIBRARY_ROOT_PDF }]);
    await page.goto('/modelos?aviso=%3Cscript%3Ealert(1)%3C/script%3E&quitar=nada');
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Quitar un modelo del registro' })).toHaveCount(0);
    expect(await page.getByRole('main').innerText()).not.toContain('script');
  });

  test('the registry file is the only thing the app writes: the library is byte-identical afterwards', async ({ page }) => {
    const before = await Promise.all(
      [LIBRARY_ROOT_PDF, LIBRARY_NESTED_PDF].map(async (path) => (await import('node:fs/promises')).stat(resolve(SCRATCH_CV_LIBRARY_DIR, ...path.split('/')))),
    );
    await page.goto('/modelos');
    await registerThroughForm(page, LIBRARY_ROOT_PDF, { name: 'A' });
    await expect(page).toHaveURL(/aviso=registered/);
    const id = await firstModelId();
    await page.request.get(`/modelos/${id}/pdf`);
    await page.getByRole('link', { name: /^Quitar del registro/ }).click();
    await page.getByRole('button', { name: 'Sí, quitar del registro' }).click();
    await expect(page).toHaveURL(/aviso=removed/);

    const after = await Promise.all(
      [LIBRARY_ROOT_PDF, LIBRARY_NESTED_PDF].map(async (path) => (await import('node:fs/promises')).stat(resolve(SCRATCH_CV_LIBRARY_DIR, ...path.split('/')))),
    );
    expect(after.map((info) => [info.size, info.mtimeMs])).toEqual(before.map((info) => [info.size, info.mtimeMs]));
  });
});

/** Id of the only registered model, read back from the registry file. */
async function firstModelId(): Promise<string> {
  const [first] = await readCvModels();
  if (first === undefined) throw new Error('no model is registered');
  return first.id;
}
