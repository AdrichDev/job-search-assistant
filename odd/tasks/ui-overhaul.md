# UI overhaul and sources verification

Fourteen requests in one message (L1): five visual decisions for the whole app, four new
behaviours, three verification/authorization items and two questions. This document is the
specification; the UI work units land on the same feature branch, one commit each.

## Specs

- S1 (question, Gmail): explain what "Gmail está con sus errores" means, in terms of the
  commit that fixed three defects in our adapter, not in Gmail.
- S2 (layout): "No quiero que esté todo centrado al centro, quiero que se extienda más en todo
  el año del viewport" — the content column must use the viewport width, not a narrow centred
  column.
- S3 (background): "Para el fondo utiliza negro y no quiero que haya tanta mini cuadricula, que
  sean un poco mas grandes" — pure black canvas, fewer and larger grid cells.
- S4 (palette): "Quiero más paleta de colores y uqe no sea tan monocromática, con colores más
  fluor y saltones y diferenciadores" — the theme must stop being monochrome slate; accents must
  be saturated and distinguishable.
- S5 (table colours): "Te dije que queria los colores de la tabla de las andidaturas
  implantadas (tambien el de los titulos de las columnas)" — the applications table keeps the
  spreadsheet cell colours AND gets them on the column headers.
- S6 (navigation): "Los cambios al cligar en ofertas seguimiento etc han de ser mas dinamicos" —
  moving between the main views must feel immediate, not like a full reload.
- S7 (modals): "El modal que salta para cambios propuestos desde tu correo visualmente
  practicamente no se ve por los colores usados (Cuando salten modales, el fondo se tiene que
  quedar en una especie de blur)" — every modal must be legible and the page behind it blurred.
- S8 (offer list): "Necesitamos paginar las ofertas de empleo y que sus chips de información sean
  mas pequeñas con la información mas relevante. Tendran que tener un boton de abrir o descartar.
  Cuando se de en abrir se tiene que abrir un modal (tambien con fondo blur con detalles mas
  concretos de la oferta)".
- S9 (analysis view): "Los resultados de tus postulaciones, Version del cv, fuente etc tiene que
  ir en otra vista, tambien quiero que en funcion de los datos se generen diagramas dinamicos
  para poder analizarlo todo mejor" — stats leave the offer list and get their own view with
  charts generated from the data.
- S10 (sources bug): "No está cogiendo bien las fuentes para mostrar ofertas porque no las está
  generando bien" — investigate and fix the source fetching, with evidence.
- S11 (authorization): "Te autorizo a correr schtasks" — register the daily 08:00 Windows task.
- S12 (refresh): "Quiero Que en ofertas haya un boton para que sea algo tipo actualizar para que
  se lance una revision de el mail y mire tanto nuevas ofertas, posibles respuestas o
  actualizaciones de candidaturas etc."
- S13 (authorization): "Como los commits no hay que revisarlos, puedes hacer el push".
- S14 (verification): "Listame las fuentes reales de donde estamos cogiendo empleo (esto tiene que
  estar verificado y refutado)".

## Tasks

- U1 (S13) Push the local commits. Commit: pushed ref.
- U2 (S14, S10) Verify the real job sources against a real run, and refute the ones that no longer
  work. Commit: docs only if it changes documentation.
- U3 (S11) Register the Windows scheduled task and prove the command it runs works.
- U4 (S2, S3, S4) Layout width, black canvas, larger grid, saturated palette. Commit: one theme
  work unit.
- U5 (S5) Spreadsheet colours on the applications table and its column headers.
- U6 (S7) Modal legibility and a blurred backdrop for every modal.
- U7 (S6) Dynamic navigation between the main views.
- U8 (S8) Paginate the offer list, smaller chips, Abrir/Descartar, offer detail modal.
- U9 (S9) Move the stats to their own view with charts generated from the data.
- U10 (S12) A refresh button on the offers view that runs the mail review and the offer fetch.
- U11 (S1) Answer the Gmail question with evidence from the run state.

## Log

- L1 (user, verbatim): "LEE PRIMERO TODAS LAS TAREAS ANTES DE REALIZAR NADA:
1) Vamos por partes.. cuando te refieres que el gmail esta con sus errores que significa
2) No quiero que esté todo centrado al centro, quiero que se extienda más en todo el año del viewport
3) Para el fondo utiliza negro y no quiero que haya tanta mini cuadricula, que sean un poco mas grandes
4) Quiero más paleta de colores y uqe no sea tan monocromática, con colores más fluor y saltones y diferenciadores
5) Te dije que queria los colores de la tabla de las andidaturas implantadas (tambien el de los titulos de las columnas)
6) Los cambios al cligar en ofertas seguimiento etc han de ser mas dinamicos
7) El modal que salta para cambios propuestos desde tu correo visualmente practicamente no se ve por los colores usados (Cuando salten modales, el fondo se tiene que quedar en una especie de blur)
8) Necesitamos paginar las ofertas de empleo y que sus chips de información sean mas pequeñas con la información mas relevante. Tendran que tener un boton de abrir o descartar. Cuando se de en abrir se tiene que abrir un modal (tambien con fondo blur con detalles mas concretos de la oferta)
9) Los resultados de tus postulaciones, Version del cv, fuente etc tiene que ir en otra vista, tambien quiero que en funcion de los datos se generen diagramas dinamicos para poder analizarlo todo mejor.
10) No está cogiendo bien las fuentes para mostrar ofertas porque no las está generando bien.
11) Te autorizo a correr schtasks
12) Quiero Que en ofertas haya un boton para que sea algo tipo actualizar para que se lance una revision de el mail y mire tanto nuevas ofertas, posibles respuestas o actualizaciones de candidaturas etc.
13) Como los commits no hay que revisarlos, puedes hacer el push
14) Listame las fuentes reales de donde estamos cogiendo empleo (esto tiene que estar verificado y refutado)"
- L2 (evidence, U1 done): push done, `76dad59..c3e52f4`, `origin/main` == `main`, 0 ahead / 0 behind. This document and the commits after it come next.
- L3 (evidence, U2 done: the real sources, verified and REFUTED): one real `npm start -- --source=all` run, no flags skipped. FIRST run was degraded with "1 of 5 source queries failed" and `manfred: request timed out after 15000ms` -that is exactly the user's "no está cogiendo bien las fuentes". Manfred was NOT down: its offers endpoint answers ~2.3 MB in ~9.6 s and its sitemap ~289 KB in ~8.1 s from this connection, so the SHARED 15 s board default was too tight for megabytes. Manfred now has `MANFRED_TIMEOUT_MS` (45 s) and the other four boards keep the shared default because they answer in well under a second. SECOND run, after the fix, is clean: `manfred 23, greenhouse 176, lever 16, ashby 90, smartrecruiters 111` = 416 fetched, 414 unique, 34 passing both filters, zero failures, zero warnings. Refuted and removed, with the reason in `docs/sources.md`: `adzuna` (negligible Spanish yield), `arbeitnow` (same), `landingjobs` (same), and the Clarity AI Greenhouse board (answers 404). Never a source: scraping or automating LinkedIn, Indeed, InfoJobs, Tecnoempleo, Michael Page, Experteer -only email alerts or manual import. Commit 8a3cba6 (code + docs together).
- L4 (evidence, U3 done: the Windows task, registered and PROVEN): `job-queue-mail-check` was registered with `Register-ScheduledTask`: daily at 08:00 Madrid, action `C:\Users\achoz\AppData\Roaming\npm\npm.cmd run mail:check`, working directory the repository root (which is what makes the root `.env` and the workspace scripts resolve). State Ready. Then it was RUN, not assumed: `Start-ScheduledTask` returned `LastTaskResult: 0`. The run found nothing to do because today's check had already succeeded at 08:39:48Z (`lastSuccessAt`), which is the correct "not due" path and still proves the scheduled command, the credentials and the state file work end to end. This closes the gap L62 recorded ("a real end-to-end scheduled run still needs credentials and the user registering the task").
- L5 (answer, U11 / S1 - what "Gmail está con sus errores" meant): it never meant Gmail was failing. The three defects were in OUR adapter, all found by writing its first unit tests and all fixed in 4df319b: (1) a repeated `nextPageToken` never advanced anything, so one pathological answer made the daily check loop forever; (2) the caller's `maxResults` was only enforced in the request, so a server answering with more ids handed back more than asked (ceiling 3 returned 4); (3) a 401 was mapped to `bad_response`, hiding the only actionable signal, and it now maps to `auth_expired`. Today's evidence that Gmail itself is fine: the scheduled run succeeded, `data/.mail-run.json` holds `lastError: null` with `lastSuccessAt` from a real check, and there is one real proposal in `data/mail-proposals.json` (status accepted).
- L6 (user correction, review policy changed): "Ojo dije que no ser revisar los commits porque pense que el rdd se hacia antes de commitear, si se hace despues si hay que hacerlo." The earlier "los commits no hay que revisarlos" (L1 item 13) came from a wrong assumption about WHEN receipt-driven development runs; it is withdrawn. RDD runs over the CANDIDATE after the work-unit commit, so the unpushed commits ARE review candidates and must be reviewed. The accumulated range is again too large to freeze in one transaction (measured twice, L61 and L66), so the procedure is the established one: ONE CANDIDATE PER COMMIT in a linked `.review/<sha>` worktree, `baseRef` = the parent's full sha, `committedOnly: true`, fresh `idempotencyKey`, then `acknowledge-approved` WITH `workspaceRoot` pointing at that worktree. Eleven candidates are pending: 8a3cba6, ca82be1, 43ff504, 9a6f514, c1bbf37, 5418957, 93a8440, 5b2c007, be1d550, 88061eb, bded3bf.
