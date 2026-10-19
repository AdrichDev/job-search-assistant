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
(None yet. Tasks are created only after the user confirms these use cases and the open questions below.)

## Log
- L1 (user, verbatim): the eight use cases above, in answer to "dame los casos de uso".
- L2 (context): earlier requirement from core-mvp-filtering L1: "saber de donde es la oferta si de infojobs, indeed, etc etc".
- L3 (user, verbatim): "1) Exacto" (to the CU4 threshold question; ambiguous between "generate when coverage is below 65%" and "above"; to be re-confirmed).
- L4 (user, verbatim): "2)Gemail (ya esta configurado en cloud, solo necesitariamos aplicarlo pero esta activo"
- L5 (user, verbatim): "3)Si todo se queda menos Experteer, me he dado cuenta que tienen otro tipo de perfiles" (Experteer is dropped; all other portals in docs/sources.md stay, plus current sources).
- L6 (user): historical Excel at D:\Descargas\Seguimiento_Candidaturas_19-10-2026_v130.xlsx (kept outside the repo; contains personal data). Structure: sheet "Candidaturas" 16 columns, 240 filled rows; sheet "Resumen".
