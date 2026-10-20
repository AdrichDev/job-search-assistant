import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { seedCvModels, writeCvModelsFile } from '../support/cv-library.js';
import {
  SCRATCH_APPLICATIONS_PATH,
  readApplications,
  readHistory,
  seedApplications,
  type SeedApplication,
} from '../support/workspace.js';

/**
 * Marking the CV model and the cover-letter model used on an application (CU8,
 * T3b). Fixtures are shaped like the real log: imported rows carry a listing and
 * no cvVariant/score, one queue-made row is a legacy 3-part fingerprint with a
 * cvVariant and no listing, and names carry accents and ñ.
 *
 * Every assertion that matters is made on the screen AND on the isolated files
 * the server really wrote.
 */

const IMPORTED_ID = 'import-aaaa1111';
const LEGACY_ID = 'beta soluciones::qa júnior::barcelona';
const OTHER_ID = 'import-bbbb2222';

const APPLICATIONS: readonly SeedApplication[] = [
  {
    jobId: IMPORTED_ID,
    appliedAt: '2026-03-01T00:00:00.000Z',
    sourceIds: ['infojobs'],
    outcome: 'applied',
    notes: `${'Nota larga con ñ y acentos. '.repeat(40)}fin`,
    listing: {
      company: 'Información Ñandú S.L.',
      title: 'Desarrollador Júnior Frontend',
      url: 'https://empleo.example.test/oferta/1',
      portal: 'InfoJobs',
      city: 'Alcobendas',
    },
  },
  {
    jobId: LEGACY_ID,
    appliedAt: '2026-02-10T12:34:56.000Z',
    cvVariant: 'general',
    scoreAtApply: 61,
    outcome: 'screening',
    outcomeUpdatedAt: '2026-02-15T12:34:56.000Z',
  },
  {
    jobId: OTHER_ID,
    appliedAt: '2026-03-05T00:00:00.000Z',
    sourceIds: ['indeed'],
    outcome: 'rejected',
    outcomeUpdatedAt: '2026-03-09T00:00:00.000Z',
    listing: { company: 'Otra Empresa', title: 'Programador Java' },
  },
];

const CV_ES = { id: 'm-cv-es', name: 'CV Desarrollador Ñandú', relativePath: 'cv-es.pdf', language: 'es' };
const CV_EN = { id: 'm-cv-en', name: 'CV Software Developer', relativePath: 'en/cv-en.pdf', language: 'en' };
const LETTER_ES = {
  id: 'm-let-es',
  name: 'Carta de presentación base',
  kind: 'letter',
  relativePath: 'carta-es.pdf',
  language: 'es',
};
const MODELS = [CV_ES, CV_EN, LETTER_ES];

const editUrl = (jobId: string) => `/seguimiento/${encodeURIComponent(jobId)}/editar`;
const cvSelect = (page: Page): Locator => page.getByLabel('Modelo de CV', { exact: true });
const letterSelect = (page: Page): Locator => page.getByLabel('Modelo de carta', { exact: true });
const saveButton = (page: Page): Locator => page.getByRole('button', { name: 'Guardar cambios' });
const historyTable = (page: Page) => page.getByRole('table', { name: /Cambios de esta postulación/ });
const trackingRow = (page: Page, company: string): Locator =>
  page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: company }) });
const modelStatsTable = (page: Page) =>
  page.getByRole('table', { name: /para cada modelo de CV registrado/ });
const formAlert = (page: Page): Locator => page.getByRole('alert').filter({ hasText: 'No se guardó nada' });
const stored = () => readFile(SCRATCH_APPLICATIONS_PATH, 'utf8');

async function applicationOf(jobId: string) {
  const found = (await readApplications()).find((entry) => entry.jobId === jobId);
  expect(found, `application ${jobId} not found`).toBeDefined();
  return found;
}

test.describe('CV and letter models on applications', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
    await seedCvModels(MODELS);
  });

  test('the selects offer only models of their kind, with name and language, and an empty first option', async ({
    page,
  }) => {
    await page.goto(editUrl(LEGACY_ID));
    await expect(cvSelect(page).locator('option')).toHaveText([
      'Sin modelo',
      'CV Desarrollador Ñandú (Español)',
      'CV Software Developer (Inglés)',
    ]);
    await expect(letterSelect(page).locator('option')).toHaveText([
      'Sin modelo',
      'Carta de presentación base (Español)',
    ]);
    await expect(cvSelect(page)).toHaveValue('');
    await expect(cvSelect(page)).toBeEnabled();
  });

  test('marks a CV and a letter model, then the Documentos column and the stats table show them', async ({
    page,
  }) => {
    await page.goto(editUrl(LEGACY_ID));
    await cvSelect(page).selectOption(CV_ES.id);
    await letterSelect(page).selectOption(LETTER_ES.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    // On disk: both references; the legacy lane and the frozen fields untouched.
    expect(await applicationOf(LEGACY_ID)).toMatchObject({
      cvModelId: CV_ES.id,
      letterModelId: LETTER_ES.id,
      cvVariant: 'general',
      scoreAtApply: 61,
      appliedAt: '2026-02-10T12:34:56.000Z',
    });
    // The other rows did not get the keys.
    expect(await applicationOf(IMPORTED_ID)).not.toHaveProperty('cvModelId');

    await expect(page.getByRole('columnheader', { name: 'Documentos' })).toBeVisible();
    const row = trackingRow(page, 'beta soluciones');
    await expect(row).toContainText('CV: CV Desarrollador Ñandú');
    await expect(row).toContainText('Carta: Carta de presentación base');
    // An imported row without any document shows a dash with an accessible text.
    await expect(trackingRow(page, 'Información Ñandú S.L.')).toContainText('Sin documentos registrados');

    await page.goto('/');
    const table = modelStatsTable(page);
    await expect(table).toBeVisible();
    await expect(table.getByRole('row')).toHaveCount(2); // header + one model
    const modelRow = table.getByRole('row', { name: /CV Desarrollador Ñandú/ });
    await expect(modelRow).toContainText('CV Desarrollador Ñandú');
    // 1 applied, 1 response (screening), 100%, 1 advanced.
    await expect(modelRow.getByRole('cell')).toHaveText(['1', '1', '100%', '1']);
    // The legacy lane-based table still shows the original CV variant.
    await expect(page.getByRole('heading', { name: /Por versión del CV \(antiguo/ })).toBeVisible();
  });

  test('a legacy application without model shows its old CV variant in Documentos', async ({ page }) => {
    await page.goto('/seguimiento');
    await expect(trackingRow(page, 'beta soluciones')).toContainText('versión antigua');
  });

  test('the stats table shows a Spanish empty state when no application has a model', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Por modelo de CV' })).toBeVisible();
    await expect(page.getByText('Todavía no has marcado ningún modelo de CV')).toBeVisible();
    await expect(modelStatsTable(page)).toHaveCount(0);
  });

  test('the change is in the history with names and can be undone', async ({ page }) => {
    await page.goto(editUrl(LEGACY_ID));
    await cvSelect(page).selectOption(CV_ES.id);
    await letterSelect(page).selectOption(LETTER_ES.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    const history = await readHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.changes).toEqual([
      { field: 'cvModelId', before: null, after: CV_ES.id },
      { field: 'letterModelId', before: null, after: LETTER_ES.id },
    ]);

    await page.goto(editUrl(LEGACY_ID));
    const row = historyTable(page).locator('tbody tr').first();
    await expect(row).toContainText('Modelo de CV');
    await expect(row).toContainText('CV Desarrollador Ñandú');
    await expect(row).toContainText('Modelo de carta');
    await expect(row).not.toContainText(CV_ES.id);

    await row.getByRole('button', { name: /Deshacer/ }).click();
    await expect(page).toHaveURL(/deshacer=deshecho/);
    await expect(cvSelect(page)).toHaveValue('');
    await expect(letterSelect(page)).toHaveValue('');
    const back = await applicationOf(LEGACY_ID);
    expect(back).not.toHaveProperty('cvModelId');
    expect(back).not.toHaveProperty('letterModelId');
    expect(back).toMatchObject({ cvVariant: 'general', scoreAtApply: 61 });
  });

  test('saving the untouched form changes nothing and leaves the file byte-identical', async ({ page }) => {
    const before = await stored();
    await page.goto(editUrl(IMPORTED_ID));
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=sin-cambios/);
    expect(await stored()).toBe(before);

    // And with models already marked.
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).selectOption(CV_EN.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    const marked = await stored();
    await page.goto(editUrl(IMPORTED_ID));
    await expect(cvSelect(page)).toHaveValue(CV_EN.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=sin-cambios/);
    expect(await stored()).toBe(marked);
  });

  test('clearing a model removes the reference', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).selectOption(CV_EN.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).selectOption('');
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    expect(await applicationOf(IMPORTED_ID)).not.toHaveProperty('cvModelId');
  });

  test('a model removed from the registry shows "Modelo ya no registrado" and survives an unrelated edit', async ({
    page,
  }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).selectOption(CV_ES.id);
    await letterSelect(page).selectOption(LETTER_ES.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    // The person removes both models from the registry afterwards.
    await seedCvModels([CV_EN]);

    await page.goto('/seguimiento');
    const row = trackingRow(page, 'Información Ñandú S.L.');
    await expect(row).toContainText('CV: Modelo ya no registrado');
    await expect(row).toContainText('Carta: Modelo ya no registrado');

    await page.goto(editUrl(IMPORTED_ID));
    await expect(cvSelect(page)).toHaveValue(CV_ES.id);
    await expect(cvSelect(page).locator('option:checked')).toHaveText(`Modelo ya no registrado (${CV_ES.id})`);
    await expect(letterSelect(page)).toHaveValue(LETTER_ES.id);
    await page.getByLabel('Ciudad', { exact: true }).fill('Madrid');
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    expect(await applicationOf(IMPORTED_ID)).toMatchObject({ cvModelId: CV_ES.id, letterModelId: LETTER_ES.id });

    // Stats keep the row with the fallback name.
    await page.goto('/');
    await expect(modelStatsTable(page).getByRole('row', { name: /Modelo ya no registrado/ })).toBeVisible();

    // The history shows the fallback too, never the raw id.
    await page.goto(editUrl(IMPORTED_ID));
    await expect(historyTable(page)).toContainText('Modelo ya no registrado');
    await expect(historyTable(page)).not.toContainText(CV_ES.id);

    // A dangling id can be cleared.
    await cvSelect(page).selectOption('');
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    expect(await applicationOf(IMPORTED_ID)).not.toHaveProperty('cvModelId');
  });

  test('a tampered or unknown id is refused in Spanish and nothing changes', async ({ page }) => {
    const before = await stored();
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).evaluate((node) => {
      const select = node as HTMLSelectElement;
      select.add(new Option('manipulado', '../../etc/passwd'));
      select.value = '../../etc/passwd';
    });
    await saveButton(page).click();
    await expect(formAlert(page)).toContainText('Ese modelo de CV no está registrado');
    expect(await stored()).toBe(before);
    expect(await readHistory()).toEqual([]);

    // A letter model offered in the CV select is a different refusal.
    await cvSelect(page).evaluate((node, id) => {
      const select = node as HTMLSelectElement;
      select.add(new Option('carta', id));
      select.value = id;
    }, LETTER_ES.id);
    await saveButton(page).click();
    await expect(formAlert(page)).toContainText('no es un CV');
    await expect(formAlert(page)).not.toContainText('no está registrado');
    expect(await stored()).toBe(before);

    // And a CV in the letter select.
    await cvSelect(page).selectOption('');
    await letterSelect(page).evaluate((node, id) => {
      const select = node as HTMLSelectElement;
      select.add(new Option('cv', id));
      select.value = id;
    }, CV_ES.id);
    await saveButton(page).click();
    await expect(formAlert(page)).toContainText('no es una carta de presentación');
    expect(await stored()).toBe(before);
  });

  test('an empty registry disables the selects with a hint linking to /modelos', async ({ page }) => {
    await seedCvModels([]);
    await page.goto(editUrl(LEGACY_ID));
    await expect(cvSelect(page)).toBeDisabled();
    await expect(letterSelect(page)).toBeDisabled();
    await expect(page.getByText('Todavía no hay modelos de este tipo registrados.').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Registrar modelos' }).first()).toHaveAttribute('href', '/modelos');
    // The rest of the form still saves, and the references stay absent.
    const before = await stored();
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=sin-cambios/);
    expect(await stored()).toBe(before);
  });

  test('an unreadable registry degrades to Spanish messages without raw errors or paths', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).selectOption(CV_ES.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    await writeCvModelsFile('{ esto no es json');
    await page.goto('/seguimiento');
    await expect(page.getByText('No se pudo leer el registro de modelos')).toBeVisible();
    await expect(trackingRow(page, 'Información Ñandú S.L.')).toContainText('Nombre no disponible');
    const text = await page.getByRole('main').innerText();
    expect(text).not.toMatch(/\.tmp|cv-models\.json|SyntaxError|JSON|Unexpected/);

    // Saving a CHANGED id cannot be validated: refused with a message, nothing written.
    const before = await stored();
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).evaluate((node) => {
      const select = node as HTMLSelectElement;
      select.add(new Option('otro', 'otro-id'));
      select.value = 'otro-id';
    });
    await saveButton(page).click();
    await expect(formAlert(page)).toContainText('No se pudo leer el registro de modelos');
    expect(await formAlert(page).innerText()).not.toMatch(/\.tmp|cv-models\.json|SyntaxError|Unexpected/);
    expect(await stored()).toBe(before);

    // The dashboard still renders.
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('works with the keyboard alone', async ({ page }) => {
    await page.goto(editUrl(LEGACY_ID));

    let reached = false;
    for (let step = 0; step < 60 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await cvSelect(page).evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the CV model select was not reachable by Tab').toBe(true);
    await page.keyboard.press('ArrowDown');
    await expect(cvSelect(page)).toHaveValue(CV_ES.id);
    await page.keyboard.press('Tab');
    await expect(letterSelect(page)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(letterSelect(page)).toHaveValue(LETTER_ES.id);

    let onSubmit = false;
    for (let step = 0; step < 60 && !onSubmit; step += 1) {
      await page.keyboard.press('Tab');
      onSubmit = await saveButton(page).evaluate((node) => node === document.activeElement);
    }
    expect(onSubmit, 'the save button was not reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/edicion=guardada/);
    expect(await applicationOf(LEGACY_ID)).toMatchObject({ cvModelId: CV_ES.id, letterModelId: LETTER_ES.id });
  });

  test('accessibility and Spanish copy: one main, labelled controls, captioned tables, no English, no console errors', async ({
    page,
    console: log,
  }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await cvSelect(page).selectOption(CV_ES.id);
    await saveButton(page).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    const surfaces = ['/seguimiento', editUrl(IMPORTED_ID), '/'];
    for (const url of surfaces) {
      await page.goto(url);
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const text = (await page.getByRole('main').innerText()).toLowerCase();
      for (const english of ['apply now', 'not applied', 'response rate', 'no jobs found', 'cv model', 'unknown model']) {
        expect(text, `untranslated copy on ${url}: "${english}"`).not.toContain(english);
      }
    }

    await page.goto(editUrl(IMPORTED_ID));
    await expect(cvSelect(page)).toBeVisible();
    await expect(letterSelect(page)).toBeVisible();
    await page.goto('/seguimiento');
    await expect(page.getByRole('table', { name: /documentos usados/ })).toBeVisible();

    const appErrors = log.errors.filter(
      (message) => !/ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource/i.test(message),
    );
    expect(appErrors, `console errors:\n${appErrors.join('\n')}`).toEqual([]);
    expect(log.pageErrors, `uncaught exceptions:\n${log.pageErrors.join('\n')}`).toEqual([]);
  });
});
