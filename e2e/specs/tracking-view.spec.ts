import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { seedApplications, type SeedApplication } from '../support/workspace.js';

/**
 * The tracking view (CU5/CU6): every application in one place, imported ones
 * included. Fixtures are shaped like the real log: imported rows carry a
 * listing and NO cvVariant/score, one queue-made row is a legacy 3-part
 * fingerprint with no sourceIds whose job is no longer queued, listing fields
 * have accents and absent keys, and urls are a mix of safe and unsafe.
 */

const QUEUED_JOB = HEALTHY_QUEUE.jobs[0];
if (QUEUED_JOB === undefined) {
  throw new Error('The healthy queue fixture is empty.');
}

const APPLICATIONS: readonly SeedApplication[] = [
  {
    // Imported, safe url, still waiting.
    jobId: 'import-aaaa1111',
    appliedAt: '2026-03-01T00:00:00.000Z',
    sourceIds: ['infojobs'],
    outcome: 'applied',
    listing: {
      company: 'Información Ñandú S.L.',
      title: 'Desarrollador Júnior Frontend',
      url: 'https://empleo.example.test/oferta/1',
      portal: 'InfoJobs',
      city: 'Alcobendas',
    },
  },
  {
    // Imported, rejected with a reply date, unsafe url, a note.
    jobId: 'import-bbbb2222',
    appliedAt: '2026-02-20T00:00:00.000Z',
    sourceIds: ['web-de-la-empresa'],
    outcome: 'rejected',
    outcomeUpdatedAt: '2026-03-02T00:00:00.000Z',
    notes: 'Respondieron por correo',
    listing: {
      company: 'Cañas y Tapas Tech',
      title: 'Programador Júnior',
      url: 'javascript:alert(1)',
      portal: 'Web de la empresa',
    },
  },
  {
    // Legacy queue-made: 3-part fingerprint, no sourceIds, job not in the queue.
    jobId: 'beta soluciones::qa júnior::barcelona',
    appliedAt: '2026-02-10T00:00:00.000Z',
    cvVariant: 'general',
    scoreAtApply: 61,
    outcome: 'screening',
    outcomeUpdatedAt: '2026-02-15T00:00:00.000Z',
  },
  {
    // Queue-made and still in the queue: facts come from the queue entry.
    jobId: QUEUED_JOB.id,
    appliedAt: '2026-03-05T00:00:00.000Z',
    cvVariant: 'frontend',
    scoreAtApply: 80,
    sourceIds: ['greenhouse'],
    outcome: 'offer',
    outcomeUpdatedAt: '2026-03-08T00:00:00.000Z',
  },
  {
    // Imported, non-web url, no reply, no city.
    jobId: 'import-cccc3333',
    appliedAt: '2026-01-15T00:00:00.000Z',
    sourceIds: ['linkedin'],
    outcome: 'no_reply',
    listing: { company: 'Wizbii Iberia', title: 'Analista Júnior', url: 'ftp://files.example.test/x' },
  },
];

const rowFor = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title });
const filterNav = (page: Page) => page.getByRole('navigation', { name: 'Filtrar por estado' });

test.describe('tracking view', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
  });

  test('lists every application, imported ones included, newest first', async ({ page }) => {
    await page.goto('/seguimiento');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seguimiento de postulaciones');
    await expect(page.getByText('5 postulaciones', { exact: true })).toBeVisible();

    const bodyRows = page.locator('tbody tr');
    await expect(bodyRows).toHaveCount(5);
    await expect(bodyRows.nth(0)).toContainText(QUEUED_JOB.title);
    await expect(bodyRows.nth(1)).toContainText('Información Ñandú S.L.');
    await expect(bodyRows.nth(2)).toContainText('Cañas y Tapas Tech');
    await expect(bodyRows.nth(3)).toContainText('beta soluciones');
    await expect(bodyRows.nth(4)).toContainText('Wizbii Iberia');
  });

  test('each row shows company, title, source, city and state', async ({ page }) => {
    await page.goto('/seguimiento');

    const imported = rowFor(page, 'Desarrollador Júnior Frontend');
    await expect(imported).toContainText('Información Ñandú S.L.');
    await expect(imported).toContainText('InfoJobs');
    await expect(imported).toContainText('Alcobendas');
    await expect(imported).toContainText('1 mar 2026');
    await expect(imported).toContainText('Aplicada');

    // Resolved from the queue entry: the log row has no listing.
    const queued = rowFor(page, QUEUED_JOB.title);
    await expect(queued).toContainText(QUEUED_JOB.company);
    await expect(queued).toContainText('Greenhouse');
    await expect(queued).toContainText(QUEUED_JOB.location);
    await expect(queued).toContainText('Oferta');

    // Parsed from the fingerprint: the job left the queue and nothing else is known.
    const legacy = rowFor(page, 'qa júnior');
    await expect(legacy).toContainText('beta soluciones');
    await expect(legacy).toContainText('barcelona');
    await expect(legacy).toContainText('Fuente no registrada');
    await expect(legacy).toContainText('Preselección');
  });

  test('the response date appears only for responses, and notes are shown', async ({ page }) => {
    await page.goto('/seguimiento');

    const rejected = rowFor(page, 'Programador Júnior');
    await expect(rejected).toContainText('Web de la empresa');
    await expect(rejected).toContainText('Rechazada');
    await expect(rejected).toContainText('2 mar 2026');
    await expect(rejected).toContainText('Respondieron por correo');
    await expect(rejected.locator('time')).toHaveCount(2);

    await expect(rowFor(page, 'Desarrollador Júnior Frontend').locator('time')).toHaveCount(1);
    await expect(rowFor(page, 'Analista Júnior').locator('time')).toHaveCount(1);
  });

  test('the offer link exists only for http(s) urls and opens safely', async ({ page }) => {
    await page.goto('/seguimiento');

    const links = page.getByRole('link', { name: /^Abrir oferta/ });
    await expect(links).toHaveCount(2); // imported https + queue entry url
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAttribute('href', /^https?:\/\//);
    }
    await expect(rowFor(page, 'Programador Júnior').getByRole('link', { name: /Abrir oferta/ })).toHaveCount(0);
    await expect(rowFor(page, 'Analista Júnior').getByRole('link', { name: /Abrir oferta/ })).toHaveCount(0);
    await expect(
      rowFor(page, 'Desarrollador Júnior Frontend').getByRole('link', { name: /Abrir oferta/ }),
    ).toHaveAttribute('href', 'https://empleo.example.test/oferta/1');
  });

  test('the outcome filter works through the query string with counts', async ({ page }) => {
    await page.goto('/seguimiento');

    const filter = filterNav(page);
    for (const text of [
      'Todas (5)',
      'Aplicada (1)',
      'Sin respuesta (1)',
      'Rechazada (1)',
      'Preselección (1)',
      'Entrevista (0)',
      'Oferta (1)',
    ]) {
      await expect(filter.getByRole('link', { name: text, exact: true })).toBeVisible();
    }
    await expect(filter.getByRole('link', { name: 'Todas (5)' })).toHaveAttribute('aria-current', 'true');

    await filter.getByRole('link', { name: 'Rechazada (1)' }).click();
    await expect(page).toHaveURL(/\/seguimiento\?estado=rejected$/);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('Cañas y Tapas Tech');
    await expect(filter.getByRole('link', { name: 'Rechazada (1)' })).toHaveAttribute('aria-current', 'true');
    await expect(filter.getByRole('link', { name: 'Todas (5)' })).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('Mostrando 1 de 5 postulaciones')).toBeVisible();

    // A filter with no match is explained, with a way back.
    await filter.getByRole('link', { name: 'Entrevista (0)' }).click();
    await expect(page.getByText('Ninguna postulación está en el estado «Entrevista»')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.getByRole('link', { name: 'Ver todas' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(5);
  });

  test('an unknown estado falls back to all', async ({ page }) => {
    await page.goto('/seguimiento?estado=__proto__');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await page.goto('/seguimiento?estado=nope');
    await expect(page.locator('tbody tr')).toHaveCount(5);
    await expect(filterNav(page).getByRole('link', { name: 'Todas (5)' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('shows a Spanish empty state when there are no applications', async ({ page }) => {
    await seedApplications([]);
    await page.goto('/seguimiento');

    await expect(page.getByText('Todavía no hay postulaciones registradas').first()).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('the navigation links both pages and marks the current one', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Secciones' });
    await expect(nav.getByRole('link', { name: 'Ofertas' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Seguimiento' })).not.toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Seguimiento' }).click();
    await expect(page).toHaveURL(/\/seguimiento$/);
    await expect(nav.getByRole('link', { name: 'Seguimiento' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Ofertas' })).not.toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Ofertas' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(nav.getByRole('link', { name: 'Ofertas' })).toHaveAttribute('aria-current', 'page');
  });

  test('no untranslated English leaks into the tracking page', async ({ page }) => {
    await page.goto('/seguimiento');
    const text = (await page.locator('body').innerText()).toLowerCase();

    for (const english of [
      'open offer',
      'applied',
      'rejected',
      'no_reply',
      'screening',
      'interview',
      'notes',
      'company',
    ]) {
      expect(text, `found untranslated copy: "${english}"`).not.toMatch(new RegExp(`\\b${english}\\b`));
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle(/Seguimiento de postulaciones/);
  });
});

test.describe('tracking view accessibility', () => {
  test.beforeEach(async ({ seed }) => {
    await seed(HEALTHY_QUEUE);
    await seedApplications(APPLICATIONS);
  });

  test('one main landmark, one h1, a captioned table with scoped headers', async ({ page }) => {
    await page.goto('/seguimiento');

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('table', { name: /Postulaciones con su empresa/ })).toBeVisible();
    await expect(page.locator('thead th[scope="col"]')).toHaveCount(10);
    await expect(page.locator('tbody th[scope="row"]')).toHaveCount(5);
    // Layout tables are forbidden: the only table is the data table.
    await expect(page.locator('table')).toHaveCount(1);
  });

  test('the skip link is first and lands on the table page', async ({ page }) => {
    await page.goto('/seguimiento');
    await expect(page.getByRole('link').first()).toContainText('Saltar a la tabla de seguimiento');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#seguimiento$/);
  });

  test('the filter is reachable by keyboard and the offer link names its job', async ({ page }) => {
    await page.goto('/seguimiento');
    await expect(
      page.getByRole('link', { name: /Abrir oferta de Desarrollador Júnior Frontend/ }),
    ).toBeVisible();

    const filterLink = page.getByRole('link', { name: 'Oferta (1)' });
    let reached = false;
    for (let step = 0; step < 40 && !reached; step += 1) {
      await page.keyboard.press('Tab');
      reached = await filterLink.evaluate((node) => node === document.activeElement);
    }
    expect(reached, 'the filter link was not reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/estado=offer/);
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('a normal session produces no console errors', async ({ page, console: log }) => {
    await page.goto('/seguimiento');
    await page.getByRole('link', { name: 'Rechazada (1)' }).click();
    await page.getByRole('link', { name: 'Ofertas', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    const appErrors = log.errors.filter(
      (message) => !/ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource/i.test(message),
    );
    expect(appErrors, `console errors:\n${appErrors.join('\n')}`).toEqual([]);
    expect(log.pageErrors, `uncaught exceptions:\n${log.pageErrors.join('\n')}`).toEqual([]);
  });
});
