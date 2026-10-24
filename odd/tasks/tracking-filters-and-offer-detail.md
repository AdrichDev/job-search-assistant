# Tracking filters and a full offer detail

Two requests from the user in one message: the tracking table must be filterable the way the
imported spreadsheet is, and the offers view must stop putting the whole offer in the list -
the list is the simplified list, and `Abrir` shows everything the way a job board does.

## Specs

- S1 (tracking filters): "El seguimiento de las postulaciones han de poder filtradas igual que
  el excel que te pase." The spreadsheet's own columns are the filter vocabulary:
  `Nombre empresa`, `Puesto / oferta`, `Ciudad`, `Portal`, `Estado`, `¿Han contestado?`,
  `Fecha solicitud`, `Fecha publicación`. The table gets filters for those, combinable (AND),
  and a combination must survive the URL so a link or a reload keeps it. Columns that only
  exist as personal notes (`Dirección`, `Teléfono`, `Persona de contacto`, `Nº listado`,
  `Información breve empresa`) are NOT filters: nobody searches by phone number.
- S2 (the list, as the user specified it): "Esto es lo que me gustaria que apareciese en las ofertas: Titulo
  oferta, empresa, localidad tipo de trabajo cuando se ha publicado (dia o hace cuantas horas)
  descripcion breve del empleo y salario, tambien años de experiencias solicitados. Tambien ha de
  poner de donde viene referido si infojobs, linkedin, manfred etc etc.." A card in `/` is a compact
  job-board row with, in this order: title, company, city, work type (`contractType`, omitted when
  null), a RELATIVE posted date ("hace 3 horas", "ayer"), a short snippet of the description, the
  salary when it exists, the required years of experience when the domain extracted a number, the
  source label(s) we actually hold, and the actions `Abrir` / `Aplicar` / `Descartar`. No chip wall.
  Only sources this project really fetches may be named: infojobs and linkedin are deliberately not
  automated sources (`docs/sources.md`), so they never appear as a source label.
- S2b (what still leaves the card): the full description, the complete requirements list, the score
  breakdown and the per-source links live only in the `Abrir` dialog. "quiero que la lista sea la
  lista simplificada" is about density, not about hiding the facts a job board shows in a row.
- S3 (full detail on open): "cuando se de a abrir salga toda la informacion de dicha oferta
  como ocurre con las ofertas cuando las ves en infojobs, indeed etc etc..". The `Abrir` dialog
  shows the FULL description (`Job.description` already exists and is not rendered today) plus
  every fact we hold: company, city, salary, contract, posted date, the sources it came from,
  the stack/requirements we detected, the score breakdown, and the link to apply. Same dialog
  surface rules as today: explicit dark palette, blurred backdrop, Escape and Cerrar.
- S4 (view is not apply): "intenta que pulse en la oferta para verla pero no para aplicar".
  Reaching a posting must not require declaring an application. The offer title in a row, and an
  explicit compact "Ver oferta" link, open the posting in a new tab and record NOTHING. `Aplicar`
  stays the deliberate action that records the application. Both are separate in the `Abrir`
  dialog too. Proof required in e2e: viewing leaves the applications log byte-identical, applying
  adds the record.
- S5 (the source of a mail-derived offer): "al leer el mail sabe de donde viene la oferta". The
  portal is knowable from the alert email (its sender), so a row that came from the mail may name
  `infojobs` or `linkedin` - that is metadata from the alert, never scraping, and it does not
  relax the project's boundary in `docs/sources.md`. Today `MailProposal` stores `jobId`, outcome,
  `messageId`, `snippet` and `evidence` but NOT the portal
  (`packages/core/src/domain/mail-proposal.ts`), so this is a separate unit that changes the core:
  capture the portal, persist it, show it. Not started.

## Tasks

- T1 (S1) Read what the applications log actually stores, then add the filter set and its URL
  round-trip; pure filtering in a tested module, the view only renders it.
- T2 (S1) Wire the filter bar into `/seguimiento`, keeping Estado counts correct under every
  other active filter.
- T3 (S2, S2b) Rebuild the offer card as the job-board row the user listed, and move the full
  description, the complete requirements, the score breakdown and the source links into the dialog.
- T4 (S2, S3) The `Abrir` dialog carries the full description plus every fact we hold.
- T5 (S2, S3, S4) e2e: the row carries the nine items, the dialog carries them plus the full
  description, and viewing an offer leaves the application log untouched while applying writes it.
- T6 (S5) Capture the portal from the mail and show it as the source of a mail-derived row. Core
  change, own unit. What the code already gives us: `MailMessage` (port) carries the sender address
  and the subject, and `propose-from-mail.ts` already matches a message to exactly one open
  application before creating a proposal. So the portal is derivable, not guessable:
  1. A pure `portalFromSender(from)` in `packages/core/src/domain/`: map the known alert domains to a
     stable label (`infojobs`, `linkedin`, `indeed`, `tecnoempleo`, `manfred`, ...); for any other
     domain return the registrable domain lowercased, EXCEPT generic mail providers (gmail, outlook,
     hotmail, yahoo, proton...), where the sender says nothing about the portal and the answer must
     be null rather than a lie. Unit tests for both paths and for a malformed address.
  2. `MailProposal` gains an OPTIONAL portal, set at creation from the matched message, persisted by
     the proposal repository the same way the other fields are, so proposals stored before this
     existed still read back fine.
  3. Show it: the proposals UI and, for a tracking row that has no imported portal, the Portal the
     alert email revealed - never invented, never overwriting an imported one.
  This is metadata from the alert, not scraping: `docs/sources.md` keeps its boundary untouched.

## Log

- L1 (user, verbatim): "El seguimiento de las postulaciones han de poder filtradas igual que el
  excel que te pase. En cuanto al UI/UX de las ofertas no te has enterado de lo que queria,
  quiero que la lista sea la lista simplificada y cuando se de a abrir salga toda la
  informacion de dicha oferta como ocurre con las ofertas cuando las ves en infojobs, indeed
  etc etc.."
- L2 (user correction, verbatim, the exact content of a row): "Esto es lo que me gustaria que
  apareciese en las ofertas: Titulo oferta, empresa, localidad tipo de trabajo cuando se ha
  publicado (dia o hace cuantas horas) descripcion breve del empleo y salario, tambien años de
  experiencias solicitados. Tambien ha de poner de donde viene referido si infojobs, linkedin,
  manfred etc etc.." S2 and S2b above are its transcription. Steered to the in-flight worker
  before it reached T3.
- L3 (user correction, verbatim): "Pero al leer el mail sabe de donde viene la oferta, intenta que
  pulse en la oferta para verla pero no para aplicar, entiendes lo que te quiero decir?" Evidence
  found for it: `apply-link.tsx` opens the posting AND records the application in one click, so
  there is no way to look at an offer without declaring an application; and `MailProposal` has no
  portal field, so the sender's portal is dropped. S4 is the view/apply split (steered to the
  in-flight worker); S5 is the mail-portal capture, a separate core unit.
