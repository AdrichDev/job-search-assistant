import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { readMailProposals, seedMailProposals } from '../support/mail.js';
import { readApplications, readHistory, seedApplications } from '../support/workspace.js';

/**
 * U5d: the mail confirmation MODAL (L51-L52).
 *
 * The mail check stays automatic, but a status change is NEVER applied without
 * the user confirming it in ONE modal that lists every candidatura that would
 * change. Aceptar applies all of them through the per-proposal accept path;
 * Cancelar and Escape apply nothing and the proposals stay pending, reachable
 * from a visible count; only an explicit per-proposal Descartar discards one,
 * and that form keeps working without JavaScript.
 *
 * Proposals are seeded straight into the isolated store: mail itself is OFF in
 * this suite (no `JOB_QUEUE_WEB_MAIL`), which is exactly the state of a user
 * who ran a check earlier and now has pending decisions waiting.
 */

const ACME = 'import-acme0001';
const BETA = 'import-beta0002';
const GAMMA = 'import-gamma0003';

async function seedStandardApplications(): Promise<void> {
  await seedApplications([
    {
      jobId: ACME,
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      listing: { company: 'Acme Sistemas', title: 'Desarrollador Backend Júnior' },
    },
    {
      jobId: BETA,
      appliedAt: '2026-03-02T00:00:00.000Z',
      sourceIds: ['indeed'],
      outcome: 'applied',
      listing: { company: 'Beta Datos', title: 'Analista Datos Junior' },
    },
    {
      jobId: GAMMA,
      appliedAt: '2026-03-03T00:00:00.000Z',
      sourceIds: ['tecnoempleo'],
      outcome: 'rejected',
      outcomeUpdatedAt: '2026-03-04T00:00:00.000Z',
      listing: { company: 'Gamma Web', title: 'Programador Frontend' },
    },
  ]);
}

const pendingProposal = (id: string, jobId: string, proposed: string, based: string) => ({
  id,
  jobId,
  proposedOutcome: proposed,
  basedOnOutcome: based,
  messageId: `msg-${id}`,
  snippet: 'Lamentamos informarte que no seguimos adelante con tu candidatura.',
  evidence: ['no seguimos adelante'],
  detectedAt: '2026-03-05T08:00:00.000Z',
  status: 'pending' as const,
});

const dialog = (page: Page) => page.getByRole('dialog');

test.describe('mail confirmation modal', () => {
  test('opens by itself, lists every candidatura that would change, and Aceptar applies all', async ({
    seed,
    page,
  }) => {
    await seed(HEALTHY_QUEUE);
    await seedStandardApplications();
    await seedMailProposals([
      pendingProposal('p1', ACME, 'rejected', 'applied'),
      pendingProposal('p2', BETA, 'screening', 'applied'),
      // Gamma is already rejected: accepting this one is a conflict, nothing is touched.
      pendingProposal('p3', GAMMA, 'rejected', 'rejected'),
    ]);

    await page.goto('/seguimiento');

    // Auto-open, once per visit, without any click.
    const modal = dialog(page);
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Cambios propuestos desde tu correo' })).toBeVisible();

    // Row facts: company, title, current state, proposed state, evidence.
    const acmeRow = modal.locator('li').filter({ hasText: 'Acme Sistemas' });
    await expect(acmeRow).toContainText('Desarrollador Backend Júnior');
    await expect(acmeRow).toContainText('Aplicada');
    await expect(acmeRow).toContainText('Rechazada');
    await expect(acmeRow).toContainText('no seguimos adelante');
    const betaRow = modal.locator('li').filter({ hasText: 'Beta Datos' });
    await expect(betaRow).toContainText('Preselección');

    // Initial focus sits inside the dialog, never behind it.
    const focusInside = await modal.evaluate((element: HTMLElement) =>
      element.contains(document.activeElement),
    );
    expect(focusInside).toBe(true);

    await modal.getByRole('button', { name: 'Aceptar' }).click();

    // The redirect carries the bulk notice, composed from both outcomes.
    await expect(page.getByRole('status')).toContainText('2 estados actualizados');
    await expect(page.getByRole('status')).toContainText('No se tocó nada');

    // Each change went through the append-only, reversible edit path.
    const applications = await readApplications();
    const acme = applications.find((row) => row.jobId === ACME);
    const beta = applications.find((row) => row.jobId === BETA);
    const gamma = applications.find((row) => row.jobId === GAMMA);
    expect(acme?.outcome).toBe('rejected');
    expect(beta?.outcome).toBe('screening');
    expect(gamma?.outcome).toBe('rejected'); // conflict: untouched

    const history = await readHistory();
    const mailEntries = history.filter((entry) => entry.source === 'email');
    expect(mailEntries).toHaveLength(2);

    // Accepted proposals are decided; the conflicting one stays pending.
    const proposals = await readMailProposals();
    const byId = new Map(proposals.map((row) => [row.id, row]));
    expect(byId.get('p1')?.status).toBe('accepted');
    expect(byId.get('p2')?.status).toBe('accepted');
    expect(byId.get('p3')?.status).toBe('pending');
  });

  test('Cancelar and Escape close the modal, apply nothing and keep the proposals pending', async ({
    seed,
    page,
  }) => {
    await seed(HEALTHY_QUEUE);
    await seedStandardApplications();
    await seedMailProposals([pendingProposal('p1', ACME, 'rejected', 'applied')]);

    await page.goto('/seguimiento');
    await expect(dialog(page)).toBeVisible();

    /*
     * Cancelar must close IN PLACE. The button lives inside a form so the
     * no-JavaScript path still works, which means the click handler has to
     * prevent the submit; without that the browser navigates, the page reloads
     * and the modal opens again by itself, so Cancelar looks broken. A window
     * marker only survives if there was no navigation.
     */
    await page.evaluate(() => {
      (globalThis as { __noReload?: string }).__noReload = 'kept';
    });
    await dialog(page).getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog(page)).not.toBeVisible();
    expect(
      await page.evaluate(() => (globalThis as { __noReload?: string }).__noReload),
    ).toBe('kept');

    // Nothing was applied, nothing was lost: the count stays visible on the page.
    await expect(page.getByText('1 propuesta pendiente del correo')).toBeVisible();

    // Escape equals Cancelar: closes, applies nothing. A reload is a new page
    // visit, so the modal opens by itself again.
    await page.reload();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).not.toBeVisible();
    await expect(page.getByText('1 propuesta pendiente del correo')).toBeVisible();

    const proposals = await readMailProposals();
    expect(proposals.map((row) => row.status)).toEqual(['pending']);
    const applications = await readApplications();
    expect(applications.find((row) => row.jobId === ACME)?.outcome).toBe('applied');
  });

  test('a per-proposal Descartar discards exactly that proposal, even without JavaScript', async ({
    seed,
    browser,
  }) => {
    await seed(HEALTHY_QUEUE);
    await seedStandardApplications();
    await seedMailProposals([
      pendingProposal('p1', ACME, 'rejected', 'applied'),
      {
        ...pendingProposal('p2', BETA, 'screening', 'applied'),
        snippet: 'Le convocamos a una entrevista la semana que viene.',
      },
    ]);

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/seguimiento');

    // No JS: no modal, but the pending proposals stay reachable and decidable.
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByText('2 propuestas pendientes del correo')).toBeVisible();

    // The fallback list opens natively (a <details>) and shows every row.
    await page.getByText('2 propuestas pendientes del correo').click();
    const list = page.locator('details');
    await expect(
      list.getByText('Lamentamos informarte que no seguimos adelante'),
    ).toBeVisible();
    await expect(list.getByText('Le convocamos a una entrevista')).toBeVisible();

    await page
      .locator('li')
      .filter({ hasText: 'Acme Sistemas' })
      .getByRole('button', { name: 'Descartar' })
      .click();

    await expect(page.getByText('Propuesta descartada.')).toBeVisible();
    await expect(page.getByText('1 propuesta pendiente del correo')).toBeVisible();

    const proposals = await readMailProposals();
    const byId = new Map(proposals.map((row) => [row.id, row]));
    expect(byId.get('p1')?.status).toBe('dismissed');
    expect(byId.get('p2')?.status).toBe('pending');
    const applications = await readApplications();
    expect(applications.find((row) => row.jobId === ACME)?.outcome).toBe('applied');

    await context.close();
  });

  test('the modal is legible against the page and blurs what is behind it', async ({
    seed,
    page,
  }) => {
    /*
     * The user's report: "el modal ... visualmente prácticamente no se ve por los
     * colores usados". The cause is the theme mirror: `bg-slate-900` maps to a
     * NEAR-WHITE surface, on a backdrop that also mapped to near-white. This
     * pins a modal that is a dark surface distinct from the page, with a blurred
     * backdrop behind it.
     */
    await seed(HEALTHY_QUEUE);
    await seedStandardApplications();
    await seedMailProposals([pendingProposal('p1', ACME, 'rejected', 'applied')]);

    await page.goto('/seguimiento');
    const modal = dialog(page);
    await expect(modal).toBeVisible();

    const style = await modal.evaluate((element) => {
      const body = getComputedStyle(document.body);
      const own = getComputedStyle(element);
      const backdrop = getComputedStyle(element, '::backdrop') as CSSStyleDeclaration & {
        webkitBackdropFilter?: string;
      };
      return {
        page: body.backgroundColor,
        dialog: own.backgroundColor,
        color: own.color,
        backdrop: backdrop.backgroundColor,
        blur: backdrop.backdropFilter || backdrop.webkitBackdropFilter,
      };
    });

    // Distinct from the page, and dark: a modal that is the page colour is invisible.
    expect(style.dialog).not.toBe(style.page);
    expect(style.dialog).toBe('rgb(15, 23, 42)');
    // The backdrop is dimmed AND blurred.
    expect(style.backdrop).not.toBe('rgba(0, 0, 0, 0)');
    expect(style.blur).toContain('blur');
    // Body text on the modal must clear AA on its own surface.
    expect(style.color).toBe('rgb(226, 232, 240)');
  });

  test('the home page offers the pending count as a link to the confirmation', async ({
    seed,
    page,
  }) => {
    /*
     * The modal lives on /seguimiento, so the home page has to say that
     * something is waiting there. Without this line a user who never opens the
     * tracking page never learns that a reply was detected.
     */
    await seed(HEALTHY_QUEUE);
    await seedStandardApplications();
    await seedMailProposals([
      pendingProposal('p1', ACME, 'rejected', 'applied'),
      pendingProposal('p2', BETA, 'screening', 'applied'),
    ]);

    await page.goto('/');

    await expect(page.getByText('2 cambios propuestos desde tu correo')).toBeVisible();
    const link = page.getByRole('link', { name: 'Ver propuestas' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/seguimiento#correo');
  });

  test('the home page stays quiet when nothing is pending', async ({ seed, page }) => {
    await seed(HEALTHY_QUEUE);
    await seedStandardApplications();

    await page.goto('/');

    await expect(page.getByRole('link', { name: 'Ver propuestas' })).toHaveCount(0);
  });
});
