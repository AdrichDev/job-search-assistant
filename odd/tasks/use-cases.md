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
- [ ] T1 (CU5) Import the historical Excel into the application log (local only, never committed). Maps "En proceso"/"Rechazado", portal, dates, URL hyperlink; skips duplicates; re-runnable. Route: test-first, synthetic fixture. Commit: pending
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
