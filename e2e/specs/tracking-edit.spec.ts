import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import {
  SCRATCH_APPLICATIONS_PATH,
  readApplications,
  seedApplications,
  type SeedApplication,
} from '../support/workspace.js';

/**
 * Manual editing of any application field (CU7). Fixtures are shaped like the
 * real log: imported rows carry a listing and NO cvVariant/score, one
 * queue-made row is a legacy 3-part fingerprint with no sourceIds and no
 * listing, names carry accents and ñ, and one note is very long.
 */

const IMPORTED_ID = 'import-aaaa1111';
const LEGACY_ID = 'beta soluciones::qa júnior::barcelona';
const LONG_NOTE = `${'Nota larga con ñ y acentos. '.repeat(120)}fin`;

const APPLICATIONS: readonly SeedApplication[] = [
  {
    jobId: IMPORTED_ID,
    appliedAt: '2026-03-01T00:00:00.000Z',
    sourceIds: ['infojobs'],
    outcome: 'applied',
    notes: LONG_NOTE,
    listing: {
      company: 'Información Ñandú S.L.',
      title: 'Desarrollador Júnior Frontend',
      url: 'https://empleo.example.test/oferta/1',
      portal: 'InfoJobs',
      city: 'Alcobendas',
    },
  },
  {
    jobId: 'import-bbbb2222',
    appliedAt: '2026-02-20T00:00:00.000Z',
    sourceIds: ['web-de-la-empresa'],
    outcome: 'rejected',
    outcomeUpdatedAt: '2026-03-02T00:00:00.000Z',
    listing: { company: 'Cañas y Tapas Tech', title: 'Programador Júnior', portal: 'Web de la empresa' },
  },
  {
    jobId: LEGACY_ID,
    appliedAt: '2026-02-10T12:34:56.000Z',
    cvVariant: 'general',
    scoreAtApply: 61,
    outcome: 'screening',
    outcomeUpdatedAt: '2026-02-15T12:34:56.000Z',
  },
];

const editUrl = (jobId: string) => `/seguimiento/${encodeURIComponent(jobId)}/editar`;
const rowFor = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });
const storedFile = () => readFile(SCRATCH_APPLICATIONS_PATH, 'utf8');

test.describe('manual edit of an application', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
  });

  test('every row has a uniquely named Editar link that opens its form', async ({ page }) => {
    await page.goto('/seguimiento');
    const links = page.getByRole('link', { name: /^Editar / });
    await expect(links).toHaveCount(3);
    const names = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
    expect(new Set(names).size).toBe(3);

    await page
      .getByRole('link', { name: 'Editar Información Ñandú S.L. - Desarrollador Júnior Frontend' })
      .click();
    await expect(page).toHaveURL(/\/editar$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Editar postulación');
  });

  test('the form shows the current values of an imported application', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await expect(page.getByLabel('Empresa', { exact: true })).toHaveValue('Información Ñandú S.L.');
    await expect(page.getByLabel('Puesto', { exact: true })).toHaveValue('Desarrollador Júnior Frontend');
    await expect(page.getByLabel('Enlace de la oferta', { exact: true })).toHaveValue('https://empleo.example.test/oferta/1');
    await expect(page.getByLabel('Ciudad', { exact: true })).toHaveValue('Alcobendas');
    await expect(page.getByLabel('Fecha de solicitud', { exact: true })).toHaveValue('2026-03-01');
    await expect(page.getByLabel('Estado de la postulación', { exact: true })).toHaveValue('applied');
    await expect(page.getByLabel('CV enviado', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Fuentes (separadas por comas)', { exact: true })).toHaveValue('infojobs');
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue(LONG_NOTE);
  });

  test('editing state and notes of an imported application shows in the table, the filter and the stats', async ({
    page,
  }) => {
    await page.goto('/');
    const stats = page.getByRole('region', { name: 'Resultados de tus postulaciones' });
    await expect(stats.getByText('2 de 3 respondieron')).toBeVisible();

    await page.goto(editUrl(IMPORTED_ID));
    await page.getByLabel('Estado de la postulación', { exact: true }).selectOption('rejected');
    await page.getByLabel('Notas', { exact: true }).fill('Rechazo por correo: «no encaja» ñandú');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    await expect(page).toHaveURL(/\/seguimiento\?edicion=guardada$/);
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados.' })).toBeVisible();
    const row = rowFor(page, 'Desarrollador Júnior Frontend');
    await expect(row).toContainText('Rechazada');
    await expect(row).toContainText('Rechazo por correo: «no encaja» ñandú');
    await expect(
      page.getByRole('navigation', { name: 'Filtrar por estado' }).getByRole('link', { name: 'Rechazada (2)' }),
    ).toBeVisible();

    await page.goto('/');
    await expect(stats.getByText('3 de 3 respondieron')).toBeVisible();

    const stored = (await readApplications()).find((entry) => entry.jobId === IMPORTED_ID);
    expect(stored?.outcome).toBe('rejected');
    expect(stored?.notes).toBe('Rechazo por correo: «no encaja» ñandú');
    // The reply date was stamped: it must not keep the application date.
    expect(stored?.outcomeUpdatedAt).not.toBe('2026-03-01T00:00:00.000Z');
  });

  test('clearing fields removes them and keeps the rest', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByLabel('Notas', { exact: true }).fill('');
    await page.getByLabel('Ciudad', { exact: true }).fill('');
    await page.getByLabel('Enlace de la oferta', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    const raw = JSON.parse(await storedFile()) as {
      applications: { jobId: string; notes?: string; listing?: Record<string, unknown> }[];
    };
    const stored = raw.applications.find((entry) => entry.jobId === IMPORTED_ID);
    expect(stored).toBeDefined();
    expect('notes' in (stored ?? {})).toBe(false);
    expect(stored?.listing && 'city' in stored.listing).toBe(false);
    expect(stored?.listing && 'url' in stored.listing).toBe(false);
    expect(stored?.listing?.company).toBe('Información Ñandú S.L.');
    expect(await readApplications()).toHaveLength(3);
  });

  test('clearing the CV of a queue-made application keeps its frozen score', async ({ page }) => {
    await page.goto(editUrl(LEGACY_ID));
    await expect(page.getByLabel('CV enviado', { exact: true })).toHaveValue('general');
    await expect(page.getByLabel('Empresa', { exact: true })).toHaveValue('beta soluciones');
    await expect(page.getByLabel('Puesto', { exact: true })).toHaveValue('qa júnior');
    await expect(page.getByLabel('Ciudad', { exact: true })).toHaveValue('barcelona');
    await page.getByLabel('CV enviado', { exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    const stored = (await readApplications()).find((entry) => entry.jobId === LEGACY_ID);
    expect(stored).toBeDefined();
    expect('cvVariant' in (stored ?? {})).toBe(false);
    expect(stored?.scoreAtApply).toBe(61);
    // Same calendar day, so the original time is kept.
    expect(stored?.appliedAt).toBe('2026-02-10T12:34:56.000Z');
  });

  test('a refused edit shows the Spanish error, keeps the input and leaves the file unchanged', async ({
    page,
  }) => {
    const before = await storedFile();
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByLabel('Enlace de la oferta', { exact: true }).fill('javascript:alert(1)');
    await page.getByLabel('Notas', { exact: true }).fill('Nota que no se debe perder ñ');
    await page.getByLabel('Estado de la postulación', { exact: true }).selectOption('interview');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    const alert = page.locator('main [role="alert"]');
    await expect(alert).toContainText('No se guardó nada');
    await expect(alert).toContainText('El enlace debe empezar por http:// o https://');
    await expect(page).toHaveURL(/\/editar$/);
    await expect(page.getByLabel('Enlace de la oferta', { exact: true })).toHaveValue('javascript:alert(1)');
    await expect(page.getByLabel('Notas', { exact: true })).toHaveValue('Nota que no se debe perder ñ');
    await expect(page.getByLabel('Estado de la postulación', { exact: true })).toHaveValue('interview');
    expect(await storedFile()).toBe(before);

    // Correcting the url then saves everything that was typed.
    await page.getByLabel('Enlace de la oferta', { exact: true }).fill('https://empleo.example.test/oferta/2');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    const stored = (await readApplications()).find((entry) => entry.jobId === IMPORTED_ID);
    expect(stored?.outcome).toBe('interview');
    expect(stored?.notes).toBe('Nota que no se debe perder ñ');
  });

  test('a blank company is refused in Spanish', async ({ page }) => {
    const before = await storedFile();
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByLabel('Empresa', { exact: true }).fill('   ');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.locator('main [role="alert"]')).toContainText('La empresa no puede quedar vacía.');
    expect(await storedFile()).toBe(before);
  });

  test('saving without changes says so and leaves the file byte-identical', async ({ page }) => {
    // Seed already normalised so a rewrite could not hide behind formatting.
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=sin-cambios$/);
    await expect(page.getByRole('status').filter({ hasText: 'No había cambios que guardar.' })).toBeVisible();
    const stored = (await readApplications()).find((entry) => entry.jobId === IMPORTED_ID);
    expect(stored?.outcomeUpdatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  test('an unknown job id shows a Spanish not-found state without crashing', async ({ page }) => {
    const response = await page.goto(editUrl('no existe::nada::en ninguna parte'));
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No encontramos esa postulación');
    await expect(page.getByRole('link', { name: 'Volver al seguimiento' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);
  });

  test('a malformed percent sequence in the url is not a server error', async ({ page }) => {
    // Next itself rejects an undecodable path with a 4xx before any page code runs.
    const response = await page.goto('/seguimiento/100%25%/editar');
    expect(response?.status()).toBeLessThan(500);
  });

  test('the whole edit can be done with the keyboard only', async ({ page }) => {
    await page.goto('/seguimiento');
    const link = page.getByRole('link', {
      name: 'Editar Información Ñandú S.L. - Desarrollador Júnior Frontend',
    });
    let reached = false;
    for (let step = 0; step < 60 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await link.evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the Editar link was not reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/editar$/);

    // Reach the notes by Tab, type, then reach the submit button and press Enter.
    const notes = page.getByLabel('Notas', { exact: true });
    let onNotes = false;
    for (let step = 0; step < 40 && !onNotes; step += 1) {
      await page.keyboard.press('Tab');
      onNotes = await notes.evaluate((node) => node === document.activeElement);
    }
    expect(onNotes, 'the notes field was not reachable by Tab').toBe(true);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Editada solo con teclado');

    const submit = page.getByRole('button', { name: 'Guardar cambios' });
    let onSubmit = false;
    for (let step = 0; step < 40 && !onSubmit; step += 1) {
      await page.keyboard.press('Tab');
      onSubmit = await submit.evaluate((node) => node === document.activeElement);
    }
    expect(onSubmit, 'the submit button was not reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/edicion=guardada/);
    await expect(rowFor(page, 'Desarrollador Júnior Frontend')).toContainText('Editada solo con teclado');
  });

  test('every control has a label, one h1 and one main, and the page is Spanish', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Editar postulación/);

    const unlabeled = await page
      .locator('main input:not([type="hidden"]), main select, main textarea')
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const labels = (node as HTMLInputElement).labels;
            return !labels || labels.length === 0;
          })
          .map((node) => node.getAttribute('name')),
      );
    expect(unlabeled).toEqual([]);

    const text = (await page.getByRole('main').innerText()).toLowerCase();
    for (const english of ['save changes', 'cancel', 'company', 'notes', 'outcome', 'applied at']) {
      expect(text, `found untranslated copy: "${english}"`).not.toMatch(new RegExp(`\\b${english}\\b`));
    }
  });

  test('a refused edit does not leak English either', async ({ page }) => {
    await page.goto(editUrl(IMPORTED_ID));
    await page.getByLabel('Enlace de la oferta', { exact: true }).fill('ftp://x.example.test/a');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    const alertText = (await page.locator('main [role="alert"]').innerText()).toLowerCase();
    for (const english of ['invalid', 'must start', 'nothing was saved', 'refused']) {
      expect(alertText).not.toContain(english);
    }
  });

  test('editing a queue-made application keeps the job queue page working', async ({ page }) => {
    await page.goto(editUrl(LEGACY_ID));
    await page.getByLabel('Notas', { exact: true }).fill('llamar el lunes');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=guardada/);
    const stored = (await readApplications()).find((entry) => entry.jobId === LEGACY_ID);
    expect(stored?.notes).toBe('llamar el lunes');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ofertas para ti');
  });
});
