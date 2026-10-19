# Product Use Cases

## Goal
Single source of truth for what the app must do. Written verbatim from the user; nothing here is summarized or added by the agent.

## Specs
- CU1. "Revisar correo de manera diaria a las 8 am hora española automaticamente, si no se hace por no poder, cuando se entre en la app automaticamente se va a tener que realizar la actualizacion."
- CU2. "Actualización diaria de opertas de empleo que se puedan sacar de leer el correo en caso de no poder acceder a las fuentes de las que hablamos anteriormente"
- CU3. "Traer ofertas de las fuentes seleccionadas"
- CU4. "Crear un cv particular, así como una posible carta de motivación para cada oferta si es que se detecta de que el perfil no es compatible en más del 65% de los requerimientos del puesto."
- CU5. "Tener un sitio unificado donde tengamos todas las candidaturas a las que aplicamos (Incluyendo un histórico de las que ya tengo yo en un excel."
- CU6. "Debemos tener dos vistas, una para el listado de puestos de trabajo y otra para hacer el seguimiento de mis aplicaciones en ofertas"
- CU7. "Todo ha de ser editable de manera manual o automatica por ejemplo en caso de rechazo por parte de empresas)"
- CU8. "Poder adjuntar tanto cv como cartas de presentacion para que luego estas puedan ser modificadas"

## Tasks
Order = lowest external risk first. Each task is a work-unit commit with tests. Nothing starts until the user confirms the order.
- [x] T1 (CU5, import part) Import the historical Excel into the application log (local only, never committed). Maps "En proceso"/"Rechazado", portal, dates, URL hyperlink; skips duplicates; re-runnable. Route: test-first, synthetic fixture. Commits: 52a60da (model), fa33413 (importer, exceljs/jszip), fca1182 (match against logged applications). Evidence: RED then GREEN at each step (model 4 failing; real-file reader 3 distinct failures reproduced then fixed; duplicates 10 failing then 18/18); typecheck ok; core 961, web 94, e2e 62/62 passed before touching data/. Real import with a git-ignored backup: 233 imported, 5 matched, 1 state updated, 2 skipped (missing applied date, rows 166 and 237); log now 258 records (25 originals + 233), 0 originals lost, only 1 original changed (outcome), 0 duplicate job ids, re-run creates nothing; stats read the real log: 258 applied, 72 responses, 3 advances, 186 pending, per-CV stats only the 25 originals. Still open for CU5: the UNIFIED PLACE where the user sees them needs the T2 tracking view; imported rows have no UI yet.
- [ ] T2 (CU6, CU7) Two views: job list and application tracking; every application field editable by hand, with visible, reversible change history. Route: test-first. Commit: pending
- [ ] T3 (CU8) Attach CV and cover-letter files to an application, replaceable and editable; stored locally outside git. Route: test-first. Commit: pending
- [ ] T4 (CU1) Gmail read-only connection, daily 08:00 Europe/Madrid run, catch-up on app open when a run was missed, alert when the 7-day Google token expires. Credentials local and gitignored. Route: test-first with a fake Gmail port. Commit: pending
- [ ] T5 (new, proposed) Detect company replies in Gmail (rejection/interview/offer) and PROPOSE the status change for user confirmation; confirmed changes are auditable and reversible (CU7). Route: test-first on real saved samples. Commit: pending
- [ ] T6 (CU2) Parse job-alert emails per portal (InfoJobs first, then Indeed, LinkedIn, Tecnoempleo, Michael Page, EmpleosIT, Wizbii) as fallback source; one parser per real sample. Route: test-first on real samples. Commit: pending
- [ ] T7 (CU4) When profile coverage of an offer's requirements is BELOW 65%, generate the TEXT of a tailored CV and cover letter for the user to edit and apply by hand. Method (language model vs templates) decided at the start of this task. Route: test-first. Commit: pending
- [ ] T8 (CU3) Confirm the selected sources list (all of docs/sources.md except Experteer, plus current sources) and align docs/sources.md and the UI labels. Route: inline. Commit: pending

## Log
- L1 (user, verbatim): the eight use cases above, in answer to "dame los casos de uso".
- L2 (context): earlier requirement from core-mvp-filtering L1: "saber de donde es la oferta si de infojobs, indeed, etc etc".
- L3 (user, verbatim): "1) Exacto" (to the CU4 threshold question; ambiguous between "generate when coverage is below 65%" and "above"; to be re-confirmed).
- L4 (user, verbatim): "2)Gemail (ya esta configurado en cloud, solo necesitariamos aplicarlo pero esta activo"
- L5 (user, verbatim): "3)Si todo se queda menos Experteer, me he dado cuenta que tienen otro tipo de perfiles" (Experteer is dropped; all other portals in docs/sources.md stay, plus current sources).
- L6 (user): historical Excel at D:\Descargas\Seguimiento_Candidaturas_19-10-2026_v130.xlsx (kept outside the repo; contains personal data). Structure: sheet "Candidaturas" 16 columns, 240 filled rows; sheet "Resumen".
- L7 (user, verbatim): "1) Te he dicho que si que lo hagas segun tu lectura" (CU4 threshold: generate when coverage is BELOW 65%).
- L8 (user, verbatim): "2) si ya hay un proyecto de google cloud, se renueva cada 7 dias, pero no pasaria nada, se programa una alerta y listo (creo que se tardaria en que google permitiera el proyecto)"
- L9 (user, verbatim): "3) Yo soy el que aplica a las empresas, unicamente ha de generar el texto y yo modifico los cv."
- L10 (user, verbatim): "4) Cuando analices mi email veras los correos."
- L11 (user, answer to "3 filas dicen que contestó pero siguen En proceso: ¿qué estado?"): "screening (en selección)".
- L12 (user, answer to "¿cómo entran las importadas en las estadísticas?"): "Embudo y por fuente; no por variante de CV".
- L13 (design, T1): imported applications use jobId = "import-" + hash(company|title|applied date|list number); outcome: Rechazado -> rejected, En proceso + contestó No -> applied, En proceso + contestó Sí -> screening; rows without applied date are skipped and reported, never invented; portal becomes the source id (slug).
- L14 (user, answer to "¿qué hago con las 5 candidaturas que están en su app y en el Excel?"): "Saltar y actualizar estado desde el Excel".
- L15 (design, T1): a row matches an application already in the log when normalized company and title are equal and the applied dates are within one day. A match is not imported again; its state is taken from the Excel only when the Excel carries a response (never replaces a recorded response with "no answer"). Measured on the real data: 5 matches, 1 state change.
- L16 (finding, T1): the real workbook is not readable by exceljs as written: a chart-only drawing without the xdr prefix, comments under xl/comments/ and a table referenced by absolute path each made it throw. The reader strips drawings, charts, comments and tables from an in-memory copy; the file on disk is never modified. The worker's synthetic tests had missed all three; they were found only by running the real file.
