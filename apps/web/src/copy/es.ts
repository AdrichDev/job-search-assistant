import type {
  ApplicationOutcome,
  CvCategory,
  CvVariant,
  JobRequirements,
  QueueApplicationStatus,
  ScoreDimension,
} from '@job-queue/core/domain';
import type { HistoryField } from '@job-queue/core';
import { ACTION_MESSAGES, type ActionMessage } from '@/copy/action-messages';
import type { CvModelNoticeCode } from '@/copy/cv-model-notices';

/**
 * Every user-facing string of the interface, in one module.
 *
 * The UI is in Spanish because the person using it asked for it in Spanish.
 * Everything else in this repository - identifiers, comments, tests, CLI output,
 * commit messages - stays in English, so this file is the single deliberate
 * language boundary rather than a slow leak of Spanish into the codebase.
 *
 * Register: neutral, professional Spanish. No voseo, no regionalisms. It should
 * read the same to someone in Madrid and someone in Bogota.
 *
 * Shape: a plain frozen object, not an i18n framework. There is exactly one
 * locale today and pulling in a runtime translation layer for it would be cost
 * without benefit. The seam is what matters - when a second locale is genuinely
 * needed, this file becomes `es.ts` next to `en.ts` behind a lookup, and no
 * component changes.
 *
 * Client-safe: type-only imports from the core domain are erased at compile
 * time, so importing this from a `'use client'` component pulls in no adapter
 * and no `node:fs`.
 */

/** Application status, as the human thinks about it. */
const STATUS: Record<QueueApplicationStatus, string> = {
  not_applied: 'Sin postular',
  applied: 'Aplicada',
  no_reply: 'Sin respuesta',
  rejected: 'Rechazada',
  screening: 'Preselección',
  interview: 'Entrevista',
  offer: 'Oferta',
};

/**
 * The outcome picker.
 *
 * `applied` reads as "Aplicada - esperando" here and plainly "Aplicada" in the
 * status chip: inside the form the user is choosing between states, so the
 * distinction from "Sin respuesta" has to be explicit.
 */
const OUTCOME: Record<ApplicationOutcome, string> = {
  applied: 'Aplicada — esperando respuesta',
  no_reply: 'Sin respuesta',
  rejected: 'Rechazada',
  screening: 'Preselección',
  interview: 'Entrevista',
  offer: 'Oferta',
};

const CV_VARIANT: Record<CvVariant, string> = {
  frontend: 'CV Frontend',
  microsoft: 'CV Microsoft',
  general: 'CV General',
};

const CV_CATEGORY_NAME: Record<CvCategory, string> = {
  java_spring_backend: 'Java / Spring backend',
  full_stack: 'Full stack',
  python_data_ai: 'Python / datos / IA',
  frontend: 'Frontend',
  qa_testing: 'QA / testing',
  microsoft_power_platform: 'Microsoft / Power Platform',
  general: 'General',
};

const WORK_MODE: Record<JobRequirements['workMode'], string> = {
  onsite: 'Presencial',
  hybrid: 'Híbrido',
  remote: 'Remoto',
  unknown: 'Modalidad no indicada',
};

const ENGLISH: Record<JobRequirements['englishRequired'], string> = {
  not_stated: 'Inglés: no indicado',
  basic: 'Inglés: básico',
  intermediate: 'Inglés: B2',
  advanced: 'Inglés: C1+',
};

const DIMENSION: Record<ScoreDimension, string> = {
  seniorityFit: 'Nivel de experiencia',
  stackMatch: 'Tecnologías',
  locationFit: 'Ubicación',
  languageFit: 'Idioma',
  recency: 'Antigüedad',
};

/**
 * Server-action results, translated by lookup on the stable English message.
 *
 * The server keeps returning its own English contract - that contract is under
 * test and has no business knowing what language the screen is in.
 */
const ACTION_RESULT: Record<ActionMessage, string> = {
  [ACTION_MESSAGES.missingJobId]: 'Falta el identificador de la oferta.',
  [ACTION_MESSAGES.recorded]: 'Postulación registrada.',
  [ACTION_MESSAGES.alreadyRecorded]: 'Ya estaba registrada.',
  [ACTION_MESSAGES.unknownJob]: 'Esa oferta no está en la cola actual.',
  [ACTION_MESSAGES.queueUnavailable]: 'No hay cola disponible. Ejecuta el pipeline primero.',
  [ACTION_MESSAGES.missingOutcome]: 'Falta la oferta o el estado.',
  [ACTION_MESSAGES.outcomeUpdated]: 'Estado actualizado.',
  [ACTION_MESSAGES.notApplied]: 'Postúlate a esta oferta antes de registrar un estado.',
  [ACTION_MESSAGES.invalidOutcome]: 'Ese estado no es válido.',

  /*
   * Descartar. El texto dice siempre que la acción es reversible, porque lo es:
   * la oferta no se borra, se oculta, y sigue disponible en «Ofertas
   * descartadas». Decirlo aquí evita tener que poner un diálogo de
   * confirmación a una acción que no destruye nada.
   */
  [ACTION_MESSAGES.dismissed]: 'Oferta descartada. Puedes recuperarla cuando quieras.',
  [ACTION_MESSAGES.alreadyDismissed]: 'Ya estaba descartada.',
  [ACTION_MESSAGES.invalidDismissalReason]: 'El motivo de descarte no es válido.',
  [ACTION_MESSAGES.cannotDismissApplied]:
    'Ya te postulaste a esta oferta. Registra su resultado en lugar de descartarla.',
  [ACTION_MESSAGES.dismissConflictUnknown]:
    'No se pudo leer el registro de postulaciones, así que no se descartó nada. Inténtalo otra vez.',
  [ACTION_MESSAGES.restored]: 'Oferta recuperada. Vuelve a estar en la lista.',
  [ACTION_MESSAGES.notDismissed]: 'Esa oferta no estaba descartada.',

  /* Edición manual de una postulación. Cada motivo de rechazo dice qué corregir. */
  [ACTION_MESSAGES.invalidInput]: 'El formulario enviado no es válido. Recarga la página e inténtalo otra vez.',
  [ACTION_MESSAGES.applicationEdited]: 'Cambios guardados.',
  [ACTION_MESSAGES.applicationUnchanged]: 'No había cambios que guardar.',
  [ACTION_MESSAGES.applicationNotFound]: 'Esa postulación no existe.',
  [ACTION_MESSAGES.invalidDate]: 'Alguna de las fechas no es válida. Usa el formato día/mes/año del selector.',
  [ACTION_MESSAGES.invalidCvVariant]: 'Ese CV no es válido.',
  [ACTION_MESSAGES.blankCompany]: 'La empresa no puede quedar vacía.',
  [ACTION_MESSAGES.blankTitle]: 'El puesto no puede quedar vacío.',
  [ACTION_MESSAGES.invalidUrl]: 'El enlace debe empezar por http:// o https://. No se guardó nada.',
  [ACTION_MESSAGES.listingIncomplete]: 'Para añadir los datos de la oferta hacen falta la empresa y el puesto.',
  [ACTION_MESSAGES.tooLong]: 'Alguno de los campos es demasiado largo.',
  [ACTION_MESSAGES.applicationEditedNotLogged]:
    'Cambios guardados, pero no se pudo anotar el cambio en el historial.',
  [ACTION_MESSAGES.unknownCvModel]: 'Ese modelo de CV no está registrado. No se guardó nada.',
  [ACTION_MESSAGES.notACvModel]: 'El modelo elegido para el CV no es un CV. No se guardó nada.',
  [ACTION_MESSAGES.unknownLetterModel]: 'Esa carta no está registrada como modelo. No se guardó nada.',
  [ACTION_MESSAGES.notALetterModel]: 'El modelo elegido para la carta no es una carta de presentación. No se guardó nada.',
  [ACTION_MESSAGES.modelRegistryUnavailable]:
    'No se pudo leer el registro de modelos, así que no se guardó nada. Inténtalo otra vez.',

  /* Historial de cambios y deshacer. Cada negativa dice por qué y no toca nada. */
  [ACTION_MESSAGES.changeReverted]: 'Cambio deshecho.',
  [ACTION_MESSAGES.changeRevertedNotLogged]:
    'Cambio deshecho, pero no se pudo anotar el deshacer en el historial.',
  [ACTION_MESSAGES.changeNotFound]: 'Ese cambio no existe.',
  [ACTION_MESSAGES.changeAlreadyReverted]: 'Ese cambio ya se había deshecho.',
  [ACTION_MESSAGES.changeNotLatest]:
    'Solo se puede deshacer el último cambio que sigue vigente. Deshaz primero los más recientes.',
  [ACTION_MESSAGES.changeConflict]:
    'La postulación se modificó fuera del historial, así que este cambio no se puede deshacer sin perder esa modificación. No se tocó nada.',
  [ACTION_MESSAGES.historyUnavailable]: 'El historial de cambios no está disponible.',

  /* Buscar ofertas. Es una búsqueda en las fuentes configuradas, no un scrapeo. */
  [ACTION_MESSAGES.fetchStarted]: 'Búsqueda iniciada.',
  [ACTION_MESSAGES.fetchAlreadyRunning]: 'Ya hay una búsqueda en curso.',
};

export const ES = {
  /* Document ---------------------------------------------------------- */
  meta: {
    title: 'Ofertas de tecnología para perfil junior — seguimiento de postulaciones',
    description:
      'Ofertas de desarrollo de software abiertas a perfil junior en Madrid, de la más reciente a la más antigua, con seguimiento de postulaciones y resultados.',
  },
  skipToContent: 'Saltar a la lista de ofertas',

  /* Header ------------------------------------------------------------ */
  header: {
    title: 'Ofertas para ti',
    subtitle: (count: number, candidate: string) =>
      `${count} ${count === 1 ? 'oferta' : 'ofertas'} para ${candidate}. Solo ofertas de desarrollo de software y sin señales de que pidan un perfil sénior. Decides tú cuáles te interesan.`,
    ordering: 'De la más reciente a la más antigua.',
    manualNotice:
      'Te postulas tú en el portal de empleo. Esta herramienta no inicia sesión en ningún sitio ni envía nada por ti.',
    generatedAt: (date: string) => `Generada el ${date}`,
    offlineFallbackTitle: 'Datos de ejemplo, no ofertas reales',
    offlineFallback:
      'Todavía no hay ninguna ejecución guardada, así que esto es el catálogo de ejemplo sin conexión. Los enlaces no llevan a ofertas reales. Ejecuta «npm start -- --source=boards» para obtener ofertas de verdad.',
    /*
     * El caso que faltaba: una ejecución REAL guardada que, aun así, contiene
     * ofertas inventadas. El aviso anterior solo aparecía cuando no había
     * ninguna ejecución guardada, de modo que estas ofertas se mostraban como
     * si fueran auténticas, con su botón de aplicar apuntando a un dominio que
     * no resuelve.
     */
    sampleDataTitle: (count: number) =>
      count === 1
        ? '1 de estas ofertas es un ejemplo, no una oferta real'
        : `${count} de estas ofertas son ejemplos, no ofertas reales`,
    sampleData: (count: number, total: number) =>
      `${count} de las ${total} ofertas de esta lista vienen del catálogo de ejemplo: las empresas no existen y sus enlaces apuntan a example-board.test, un dominio reservado que no resuelve, así que su botón «Aplicar» no lleva a ninguna parte. Están marcadas con la etiqueta «Ejemplo». Vuelve a ejecutar «npm start -- --source=all» para sustituirlas por ofertas reales.`,
  },

  /* Run health -------------------------------------------------------- */
  degraded: {
    title: 'Ejecución degradada',
    failedTitle: (count: number) =>
      count === 1
        ? '1 consulta de origen falló en esta ejecución'
        : `${count} consultas de origen fallaron en esta ejecución`,
    explanation:
      'Faltan resultados de esas consultas, así que esta lista puede estar incompleta. Los datos anteriores no se han borrado.',
    unknownError: 'error desconocido',
  },

  /* Stats ------------------------------------------------------------- */
  stats: {
    heading: 'Resultados de tus postulaciones',
    empty:
      'Todavía no hay postulaciones registradas. En cuanto te postules a algunas ofertas, aquí verás qué versión del CV convierte mejor.',
    funnelHeading: 'Embudo completo',
    surfaced: 'Ofertas vistas',
    applied: 'Postulaciones',
    responses: 'Respuestas',
    interviews: 'Entrevistas',
    offers: 'Ofertas laborales',
    stageRate: (rate: string) => `${rate} desde la etapa anterior`,
    responseRate: 'Tasa de respuesta',
    responseHint: (responses: number, total: number) => `${responses} de ${total} respondieron`,
    advanced: 'Avanzaron',
    advancedHint: (count: number) => `${count} llegaron a preselección o más`,
    pending: 'Esperando respuesta',
    byVariantHeading: 'Por versión del CV (antiguo, por tipo de oferta)',
    variantTableCaption:
      'Tasa de respuesta y de avance para cada versión del CV, el desglose antiguo por tipo de oferta',
    columnVariant: 'Versión del CV',
    byModelHeading: 'Por modelo de CV',
    modelTableCaption: 'Tasa de respuesta y de avance para cada modelo de CV registrado',
    columnModel: 'Modelo de CV',
    noModelsYet:
      'Todavía no has marcado ningún modelo de CV en tus postulaciones. Márcalo al editar una postulación y aquí verás cuál convierte mejor.',
    smallModelSample:
      'Menos de 10 postulaciones con modelo de CV marcado: trata estos porcentajes como anécdotas, no como evidencia.',
    bySourceHeading: 'Por fuente',
    sourceTableCaption: 'Tasa de respuesta y de avance para cada fuente de ofertas',
    columnSource: 'Fuente',
    unknownSource: 'Fuente no registrada',
    columnApplied: 'Postulaciones',
    columnResponses: 'Respuestas',
    columnResponseRate: 'Tasa de respuesta',
    columnAdvanced: 'Avanzaron',
    smallSample:
      'Menos de 10 postulaciones registradas: trata estos porcentajes como anécdotas, no como evidencia.',
  },

  /* Queue and filters -------------------------------------------------- */
  queue: {
    heading: 'Ofertas',
    /** El número que importa: cuántas ofertas hay realmente. */
    total: (count: number) => `${count} ${count === 1 ? 'oferta' : 'ofertas'}`,
    orderingNote: 'De la más reciente a la más antigua.',
    searchLabel: 'Buscar por puesto, empresa, ubicación o tecnología',
    searchPlaceholder: 'react, Alcobendas, ACME…',
    cvLabel: 'Versión del CV',
    statusLabel: 'Estado de la postulación',
    showing: (visible: number, total: number) =>
      `Mostrando ${visible} de ${total} ${total === 1 ? 'oferta' : 'ofertas'}`,
    noMatches: 'Ninguna oferta coincide con estos filtros.',
    noMatchesHint: 'Prueba a borrar el texto de búsqueda o a poner los filtros en «Todas».',
    cvOptionAll: 'Todas las versiones',
    sourceLabel: 'Fuente',
    sourceOptionAll: (total: number) => `Todas las fuentes (${total})`,
    sourceOption: (label: string, count: number) => `${label} (${count})`,
    statusOptionAll: 'Todas las ofertas',
    statusOptionPending: 'Sin postular',
    statusOptionApplied: 'Ya postuladas',
  },

  /* Source provenance ---------------------------------------------------- */
  source: {
    /** Solo fuentes con adaptador real; nada de portales que no soportamos. */
    labels: {
      arbeitnow: 'Arbeitnow',
      ashby: 'Ashby',
      fixture: 'Ejemplo (catálogo)',
      greenhouse: 'Greenhouse',
      landingjobs: 'Landing.jobs',
      lever: 'Lever',
      manfred: 'Manfred',
      smartrecruiters: 'SmartRecruiters',
    } as Readonly<Record<string, string>>,
    unknown: (sourceId: string) =>
      sourceId.length === 0 ? 'Fuente desconocida' : `Fuente desconocida (${sourceId})`,
    cardLabel: (count: number) => (count === 1 ? 'Fuente' : 'Fuentes'),
    noSources: 'Fuente no registrada',
  },

  /* Empty / degraded queue --------------------------------------------- */
  emptyQueue: {
    headingDegraded: 'La última ejecución no obtuvo ofertas',
    bodyDegraded:
      'Las consultas al origen de datos fallaron, así que no hay nada nuevo que mostrar. Tus datos anteriores no se han sobrescrito.',
    headingEmpty: 'La cola está vacía',
    bodyEmpty:
      'Las consultas se ejecutaron correctamente, pero ninguna oferta pasó los dos filtros: tiene que ser una oferta de desarrollo de software y no puede indicar explícitamente que buscan un perfil sénior.',
    whatToDo: 'Qué puedes hacer',
    stepRerun: 'Vuelve a ejecutar el pipeline cuando el origen de datos se recupere.',
    stepBoards:
      'Usa los portales de empresa con «npm start -- --source=boards»: no necesitan clave ni cuota.',
    stepOffline: 'Consulta el catálogo de ejemplo con «npm run start:offline».',
  },

  /* Job card ----------------------------------------------------------- */
  card: {
    score: 'Puntuación',
    scoreOutOf: 'sobre 100',
    postedToday: 'Publicada hoy',
    postedAgo: (days: number) => `Publicada hace ${days} ${days === 1 ? 'día' : 'días'}`,
    salaryRange: (min: string, max: string) => `${min}–${max} €`,
    salaryFrom: (min: string) => `desde ${min} €`,
    requirementsLabel: 'Requisitos detectados',
    yearsRequired: (years: number) => `${years} ${years === 1 ? 'año' : 'años'} de experiencia`,
    /*
     * La etiqueta viaja con la oferta, no solo en el banner de arriba: la lista
     * es más larga que una pantalla y el aviso de cabecera desaparece justo
     * cuando la persona está decidiendo a cuál aplicar.
     */
    sampleBadge: 'Ejemplo',
    sampleBadgeTitle: 'Oferta inventada del catálogo de ejemplo. Su enlace no lleva a ninguna oferta real.',
    /*
     * Enlace que no pudimos comprobar.
     *
     * Deliberadamente discreto. Solo se eliminan las ofertas cuyo enlace
     * responde 404 o 410; todo lo demás se mantiene, y la inmensa mayoría de
     * estos casos son webs de empleo con protección antibots que responden 403
     * a cualquier comprobación automática. Presentarlo como una alerta haría
     * que la persona desconfiara de ofertas perfectamente vivas, y ahogaría el
     * aviso de «Ejemplo», que sí señala una oferta inventada.
     *
     * El texto dice explícitamente que la oferta SE MANTIENE y que no hay
     * prueba de que haya desaparecido, porque sin esa frase la etiqueta se lee
     * como «esta oferta probablemente ya no existe», que es justo lo contrario
     * de lo que significa.
     */
    unverifiedBadge: 'Sin verificar',
    unverifiedBadgeTitle:
      'No pudimos verificar este enlace: el servidor no respondió o rechazó nuestra ' +
      'comprobación automática. La oferta se mantiene en la lista porque no hay prueba ' +
      'de que haya desaparecido.',
    juniorSignalTitle: 'Señal junior en el título',
    juniorSignalDescription: 'Señal junior en la descripción',
    seniorSignalTitle: 'Señal senior en el título',
    seniorSignalDescription: 'Señal senior en la descripción',
    moreStack: (count: number) => `+${count} más`,
  },

  /* How the list is built ---------------------------------------------- */
  method: {
    footerNote:
      'La lista no está ordenada por puntuación ni recortada por ella: aparecen todas las ofertas de desarrollo de software que no indican explícitamente un perfil sénior, de la más reciente a la más antigua. La puntuación se sigue calculando y se guarda para poder comparar después qué ofertas responden, pero no decide qué ves ni en qué orden.',
  },

  /* Apply -------------------------------------------------------------- */
  apply: {
    action: 'Aplicar',
    applied: 'Aplicada',
    openAgain: 'Abrir la oferta otra vez',
    pending: 'Registrando…',
    dualPurpose: 'Abre la oferta en una pestaña nueva y registra la postulación.',
    dualPurposeApplied: 'Ya registrada. Puedes volver a abrir la oferta cuando quieras.',
    screenReader: (title: string) =>
      `Aplicar a ${title}. Abre la oferta en una pestaña nueva y registra la postulación.`,
    screenReaderApplied: (title: string) =>
      `Volver a abrir la oferta de ${title}. Ya está registrada como postulación.`,
  },

  /* Dismiss ------------------------------------------------------------ */
  /*
   * Acción secundaria. El color de acento pertenece a «Aplicar», que es la
   * acción principal de toda la interfaz; descartar tiene que ser accesible y
   * legible sin competir con ella por la mirada.
   *
   * No hay diálogo de confirmación a propósito. Confirmar es lo que se hace
   * antes de algo irreversible, y esto no lo es: la oferta se puede recuperar
   * en un clic. Poner un diálogo aquí enseñaría a la persona a descartar
   * diálogos, que es justo lo que no queremos el día que aparezca uno de
   * verdad. En su lugar, el texto dice que se puede deshacer.
   */
  dismiss: {
    action: 'Descartar',
    pending: 'Descartando…',
    reasonLabel: 'Motivo (opcional)',
    reasonPlaceholder: 'Sin especificar',
    reasonOptions: {
      role_mismatch: 'El puesto no encaja',
      seniority_mismatch: 'Nivel de experiencia inadecuado',
      stack_mismatch: 'Tecnologías que no encajan',
      location: 'Ubicación o modalidad',
      compensation: 'Salario o condiciones',
      other: 'Otro motivo',
    },
    hint: 'No te la volveremos a mostrar. Puedes recuperarla cuando quieras.',
    screenReader: (title: string) =>
      `Descartar la oferta de ${title}. Se oculta de la lista y puedes recuperarla en «Ofertas descartadas».`,
    /* Acción no disponible: ya te postulaste. Se explica, no se esconde. */
    blockedByApplication: 'Ya postulada',
    blockedByApplicationTitle:
      'No se puede descartar una oferta a la que ya te postulaste: sigue en la lista para que puedas registrar qué respondieron. Usa «Registrar el resultado».',
  },

  /* Dismissed review section -------------------------------------------- */
  dismissed: {
    summary: (count: number) =>
      count === 1 ? '1 oferta descartada' : `${count} ofertas descartadas`,
    intro:
      'Las ofertas descartadas no se borran: se ocultan de la lista y siguen aquí. Ninguna se pierde y todas se pueden recuperar.',
    restore: 'Recuperar',
    restorePending: 'Recuperando…',
    restoreScreenReader: (title: string) =>
      `Recuperar la oferta de ${title}. Vuelve a aparecer en la lista principal.`,
    dismissedAt: (date: string) => `Descartada el ${date}`,
    /*
     * La oferta ya no está en la cola actual. Se sigue mostrando, con su
     * título y empresa guardados en el momento de descartarla, porque una fila
     * que no se puede leer ni recuperar sería peor que no tenerla.
     */
    goneFromQueue: 'Ya no está en la lista de esta ejecución',
    goneFromQueueTitle:
      'Esta oferta ya no aparece en la última ejecución del pipeline. Puedes recuperarla igualmente: reaparecerá si una próxima ejecución vuelve a encontrarla.',
    empty: 'No has descartado ninguna oferta.',
  },

  /* Fetch --------------------------------------------------------------- */
  /*
   * BUSCAR, no «scrapear». La diferencia no es de estilo: esta herramienta
   * consulta APIs públicas y boletines que la persona ha guardado, y no navega
   * ni analiza el HTML de ningún portal de empleo. Llamarlo scrapeo describiría
   * algo que el programa no hace y que además tiene prohibido hacer.
   */
  fetch: {
    action: 'Buscar ofertas',
    pending: 'Buscando ofertas…',
    hint: 'Consulta las fuentes configuradas: APIs de empleo y los boletines que has guardado.',
    screenReader: 'Buscar ofertas nuevas en todas las fuentes configuradas.',
    /* Estado. Nunca solo color: cada estado se dice con palabras. */
    statusIdle: 'Todavía no has lanzado ninguna búsqueda desde aquí.',
    statusRunning: (startedAt: string) =>
      `Búsqueda en curso desde las ${startedAt}. Puede tardar unos minutos; puedes seguir usando la página.`,
    statusRunningShort: 'Búsqueda en curso',
    statusFinished: (finishedAt: string) => `Última búsqueda terminada a las ${finishedAt}`,
    statusFailed: (finishedAt: string) => `La búsqueda falló a las ${finishedAt}`,
    failedDetail: (error: string) =>
      `No se pudo completar la búsqueda: ${error}. Tus datos anteriores no se han tocado.`,
    alreadyRunning: 'Ya hay una búsqueda en curso. No se ha lanzado una segunda.',
    reloadHint: 'Recarga la página para ver las ofertas nuevas.',

    /* El resumen de la ejecución, con los mismos números que imprime la CLI. */
    summaryHeading: 'Resultado de la última búsqueda',
    fetched: (count: number) =>
      `${count} ${count === 1 ? 'oferta encontrada' : 'ofertas encontradas'} en total`,
    deduped: (unique: number, duplicates: number) =>
      `${unique} ${unique === 1 ? 'única' : 'únicas'} tras agrupar ${duplicates} ${
        duplicates === 1 ? 'duplicada' : 'duplicadas'
      }`,
    filteredNotSoftware: (count: number) =>
      `${count} descartadas por no ser ofertas de desarrollo de software`,
    filteredByLocation: (count: number) =>
      `${count} descartadas por estar fuera de Madrid y no ser remoto desde España`,
    filteredNotJunior: (count: number) =>
      `${count} descartadas por pedir más de 2 años de experiencia o un perfil sénior, lead o manager`,
    removedAsGone: (count: number) =>
      `${count} eliminadas porque su enlace ya no existe (HTTP 404 o 410)`,
    available: (count: number) =>
      `${count} ${count === 1 ? 'oferta disponible' : 'ofertas disponibles'} para ti`,
    failedSourcesHeading: (count: number) =>
      count === 1
        ? '1 fuente falló en esta búsqueda'
        : `${count} fuentes fallaron en esta búsqueda`,
    failedSource: (sourceId: string, query: string, error: string) =>
      `${sourceId} «${query}»: ${error}`,
    /*
     * La protección de escritura, dicha como lo que es: tus datos se han
     * conservado. No es un fallo del botón, es el sistema negándose a
     * sustituir ofertas reales por el vacío que dejó una ejecución rota.
     */
    refusedHeading: 'No se sobrescribió la lista anterior',
    refusedDetail: (reason: string) => `Motivo: ${reason}`,
    refusedPreserved: (count: number) =>
      `Se han conservado intactas las ${count} ${count === 1 ? 'oferta' : 'ofertas'} que ya tenías.`,
    refusedPreservedUnknown: 'Se ha conservado intacta la lista que ya tenías.',
    warningsHeading: 'Avisos de esta búsqueda',
  },

  /* Score breakdown ---------------------------------------------------- */
  score: {
    summary: (total: string) => `Ver puntuación estimada (${total} sobre 100)`,
    intro:
      'Dato secundario: esta puntuación no ordena la lista ni descarta ofertas. Se calcula y se guarda para poder comprobar más adelante si las ofertas mejor puntuadas responden más. Es la suma de cinco dimensiones ponderadas.',
    tableCaption:
      'Desglose de la puntuación por dimensión, con la aportación ponderada y su motivo',
    columnDimension: 'Dimensión',
    columnContribution: 'Aporta',
    columnReason: 'Motivo',
    points: (value: string) => `${value} pts`,
    detail: (value: string, weight: string) => `valor ${value} × peso ${weight}`,
    total: 'Total',
    barLabel: (dimension: string, points: string) => `${dimension} aporta ${points} puntos`,
  },

  /* Outcome form -------------------------------------------------------- */
  outcome: {
    legend: 'Registrar el resultado',
    label: 'Estado',
    notesLabel: 'Notas (opcional)',
    notesPlaceholder: 'Llamada el viernes',
    submit: 'Guardar estado',
  },

  /* Seguimiento ---------------------------------------------------------- */
  tracking: {
    nav: {
      label: 'Secciones',
      offers: 'Ofertas',
      tracking: 'Seguimiento',
      models: 'Modelos',
    },
    skipToContent: 'Saltar a la tabla de seguimiento',
    meta: {
      title: 'Seguimiento de postulaciones',
      description: 'Todas tus postulaciones en un solo sitio, de la más reciente a la más antigua, con su estado y su respuesta.',
    },
    heading: 'Seguimiento de postulaciones',
    intro:
      'Todas las ofertas a las que te has postulado, tanto desde esta herramienta como las importadas de tu histórico. De la más reciente a la más antigua.',
    total: (count: number) => `${count} ${count === 1 ? 'postulación' : 'postulaciones'}`,
    showingRange: (from: number, to: number, total: number) =>
      total === 1
        ? 'Mostrando 1–1 de 1 postulación'
        : `Mostrando ${from}–${to} de ${total} postulaciones`,
    pagination: {
      label: 'Paginación',
      first: 'Primera',
      prev: 'Anterior',
      page: (page: number, total: number) => `Página ${page} de ${total}`,
      next: 'Siguiente',
      last: 'Última',
    },
    filter: {
      label: 'Filtrar por estado',
      all: 'Todas',
      option: (label: string, count: number) => `${label} (${count})`,
    },
    caption:
      'Postulaciones con su empresa, puesto, fuente, ciudad, fechas, estado, documentos usados y notas',
    columns: {
      company: 'Empresa',
      title: 'Puesto',
      source: 'Fuente',
      city: 'Ciudad',
      appliedAt: 'Fecha de solicitud',
      status: 'Estado',
      responded: '¿Contestó?',
      respondedAt: 'Fecha de respuesta',
      documents: 'Documentos',
      notes: 'Notas',
      actions: 'Acciones',
    },
    documents: {
      cv: 'CV',
      letter: 'Carta',
      legacyVariant: (label: string) => `${label} (versión antigua)`,
      none: 'Sin documentos registrados',
    },
    edit: 'Editar',
    editHint: (company: string, title: string) =>
      `Editar ${company.length > 0 ? company : 'empresa no indicada'} - ${title}`,
    notice: {
      saved: 'Cambios guardados.',
      unchanged: 'No había cambios que guardar.',
      savedNotLogged: 'Cambios guardados, pero no se pudo anotar el cambio en el historial.',
    },
    scrollRegion: 'Tabla de postulaciones, desplázala horizontalmente si no cabe',
    openOffer: 'Abrir oferta',
    openOfferHint: (title: string, company: string) =>
      `de ${title}${company.length > 0 ? ` en ${company}` : ''} (se abre en una pestaña nueva)`,
    noCompany: 'Empresa no indicada',
    noCity: 'No indicada',
    noResponseDate: 'Sin respuesta todavía',
    noNotes: 'Sin notas',
    /** The spreadsheet text may mix company and job facts, so it keeps the original column name. */
    companyInfo: {
      summary: 'Información breve empresa',
      publishedAt: 'Fecha de publicación',
    },
    emptyAllTitle: 'Todavía no hay postulaciones registradas',
    emptyAllBody:
      'Cuando te postules desde «Ofertas» o importes tu histórico, aparecerán aquí.',
    emptyFilterTitle: (label: string) => `Ninguna postulación está en el estado «${label}»`,
    emptyFilterBody: 'Elige otro estado o vuelve a ver todas las postulaciones.',
    emptyFilterAction: 'Ver todas',
    warningTitle: 'No se pudo leer todo',
    warning: {
      applications: (detail: string) =>
        `No se pudo leer el registro de postulaciones, así que la lista puede estar incompleta. ${detail}`,
      models: (_detail: string) =>
        'No se pudo leer el registro de modelos: los documentos se muestran sin nombre.',
      queue: (detail: string) =>
        `No se pudo leer la cola guardada: las postulaciones sin datos propios se muestran con lo que se guardó al postularte. ${detail}`,
    },
    /** Portales del histórico importado: solo se usan en esta vista. */
    portalLabels: {
      infojobs: 'InfoJobs',
      'web-de-la-empresa': 'Web de la empresa',
      linkedin: 'LinkedIn',
      indeed: 'Indeed',
      tecnoempleo: 'Tecnoempleo',
      'michael-page': 'Michael Page',
      juniorjobs: 'JuniorJobs',
      adzuna: 'Adzuna',
      empleosit: 'EmpleosIT',
      wizbii: 'Wizbii',
    } as Readonly<Record<string, string>>,
  },

  /* Editar una postulación ---------------------------------------------- */
  edit: {
    meta: { title: 'Editar postulación' },
    heading: 'Editar postulación',
    intro:
      'Corrige a mano cualquier dato. Un campo de texto vacío se borra; los datos que no toques se quedan como están. Las fechas que cambies se guardan como ese día.',
    back: 'Volver al seguimiento',
    cancel: 'Cancelar',
    submit: 'Guardar cambios',
    errorTitle: 'No se guardó nada',
    notFoundTitle: 'No encontramos esa postulación',
    notFoundBody: 'Puede que se haya cambiado el identificador o que el registro ya no la tenga.',
    groups: {
      state: 'Estado',
      offer: 'La oferta',
      contact: 'Contacto y empresa',
      application: 'Cómo te postulaste',
    },
    fields: {
      outcome: 'Estado de la postulación',
      outcomeUpdatedAt: 'Fecha de respuesta',
      appliedAt: 'Fecha de solicitud',
      notes: 'Notas',
      cvVariant: 'CV enviado',
      noCv: 'Sin CV registrado',
      cvModel: 'Modelo de CV',
      letterModel: 'Modelo de carta',
      noModel: 'Sin modelo',
      danglingModel: (id: string) => `Modelo ya no registrado (${id})`,
      noModelsHint: 'Todavía no hay modelos de este tipo registrados.',
      noModelsLink: 'Registrar modelos',
      modelsUnavailableHint: 'No se pudo leer el registro de modelos; se conserva la opción actual.',
      sourceIds: 'Fuentes (separadas por comas)',
      company: 'Empresa',
      title: 'Puesto',
      url: 'Enlace de la oferta',
      portal: 'Portal',
      city: 'Ciudad',
      address: 'Dirección',
      phone: 'Teléfono',
      contact: 'Persona de contacto',
      companyInfo: 'Información breve empresa',
      publishedAt: 'Fecha de publicación',
    },
    hints: {
      company: 'Obligatoria.',
      title: 'Obligatorio.',
      url: 'Debe empezar por http:// o https://. Vacío para quitarlo.',
      noListing:
        'Esta postulación salió de la lista de ofertas y no guarda datos propios. Al guardar, se guardan la empresa y el puesto que ves aquí.',
      outcomeDate:
        'Si cambias el estado y dejas la fecha como está, se anota la de hoy.',
    },
  },

  /* Historial de cambios -------------------------------------------------- */
  history: {
    heading: 'Historial de cambios',
    intro:
      'Cada cambio que se guarda queda anotado aquí, del más reciente al más antiguo. El historial nunca se borra: deshacer un cambio añade una anotación nueva.',
    caption: 'Cambios de esta postulación, del más reciente al más antiguo',
    columns: { date: 'Fecha', source: 'Origen', changes: 'Cambios', action: 'Acción' },
    sources: { manual: 'Manual', import: 'Importación', revert: 'Deshacer', email: 'Correo' },
    emptyTitle: 'Todavía no hay cambios anotados',
    emptyBody: 'Cuando edites esta postulación, cada cambio aparecerá aquí y podrás deshacerlo.',
    warningTitle: 'No se pudo leer el historial',
    warning: (detail: string) =>
      `El historial de cambios no se pudo cargar, pero puedes seguir editando la postulación. ${detail}`,
    unavailableWarning: 'El historial de cambios no está configurado en esta instalación.',
    emptyValue: 'vacío',
    arrow: 'antes → después',
    before: 'Antes',
    after: 'Después',
    truncatedHint: 'Texto acortado aquí; el historial guarda el texto completo.',
    noFieldChanges: 'Sin cambios en los campos (se anotó solo el deshacer).',
    reverted: 'Deshecho',
    revertsEntry: (date: string) => `Deshace el cambio del ${date}`,
    undo: 'Deshacer',
    undoHint: (date: string) => `Deshacer el cambio del ${date}`,
    undoDescription:
      'Solo se puede deshacer el último cambio vigente, y solo si la postulación no se modificó fuera del historial.',
    fields: {
      appliedAt: 'Fecha de solicitud',
      outcome: 'Estado de la postulación',
      outcomeUpdatedAt: 'Fecha de respuesta',
      cvVariant: 'CV enviado',
      cvModelId: 'Modelo de CV',
      letterModelId: 'Modelo de carta',
      notes: 'Notas',
      sourceIds: 'Fuentes',
      'listing.company': 'Empresa',
      'listing.title': 'Puesto',
      'listing.url': 'Enlace de la oferta',
      'listing.portal': 'Portal',
      'listing.city': 'Ciudad',
      'listing.address': 'Dirección',
      'listing.phone': 'Teléfono',
      'listing.contact': 'Persona de contacto',
      'listing.companyInfo': 'Información breve empresa',
      'listing.publishedAt': 'Fecha de publicación',
    } as Readonly<Record<HistoryField, string>>,
  },

  /* Modelos de CV y cartas ------------------------------------------------ */
  models: {
    skipToContent: 'Saltar a los modelos',
    meta: {
      title: 'Modelos de CV y cartas',
      description: 'Tus CV y cartas de presentación base, registrados desde tu carpeta sin moverlos ni modificarlos.',
    },
    heading: 'Modelos de CV y cartas',
    intro:
      'Los PDF que usas como base para tus candidaturas. La herramienta solo los lee desde tu carpeta: nunca los mueve, los cambia ni los borra.',
    total: (count: number) => `${count} ${count === 1 ? 'modelo registrado' : 'modelos registrados'}`,
    caption: 'Modelos registrados con su tipo, idioma, etiquetas y disponibilidad',
    columns: {
      name: 'Nombre',
      kind: 'Tipo',
      language: 'Idioma',
      tags: 'Etiquetas',
      status: 'Estado',
      actions: 'Acciones',
    },
    notRegisteredAnymore: 'Modelo ya no registrado',
    nameUnavailable: 'Nombre no disponible',
    kinds: { cv: 'CV', letter: 'Carta de presentación' } as const,
    languages: { es: 'Español', en: 'Inglés' } as const,
    noTags: 'Sin etiquetas',
    available: 'Disponible',
    unavailable: 'No disponible',
    unavailableHint: 'El archivo ya no está en la carpeta o no se puede abrir de forma segura. El modelo sigue registrado.',
    open: 'Abrir PDF',
    openHint: (name: string) => `Abrir el PDF de ${name} en una pestaña nueva`,
    edit: 'Editar',
    editHint: (name: string) => `Editar ${name}`,
    remove: 'Quitar del registro',
    removeHint: (name: string) => `Quitar ${name} del registro`,
    emptyTitle: 'Todavía no hay modelos registrados',
    emptyBody: 'Elige abajo un PDF de tu carpeta y regístralo con un nombre, un tipo y un idioma.',
    confirm: {
      heading: 'Quitar un modelo del registro',
      body: (name: string) =>
        `Vas a quitar «${name}» del registro. El archivo PDF no se toca: sigue en tu carpeta y podrás registrarlo otra vez.`,
      yes: 'Sí, quitar del registro',
      cancel: 'Cancelar',
    },
    register: {
      heading: 'Registrar un modelo',
      intro: 'PDF de tu carpeta que aún no están registrados. Abre uno para darle nombre, tipo, idioma y etiquetas.',
      none: 'No hay PDF nuevos en la carpeta para registrar.',
      truncated: 'La carpeta tiene muchos PDF y solo se muestran los primeros.',
      pick: (path: string) => `Registrar ${path}`,
      submit: 'Registrar modelo',
      pathLabel: 'Archivo',
    },
    fields: {
      name: 'Nombre',
      kind: 'Tipo',
      language: 'Idioma',
      tags: 'Etiquetas (separadas por comas)',
      note: 'Nota (opcional)',
      path: 'Archivo en la carpeta',
    },
    hints: {
      tags: 'Hasta 12 etiquetas de 40 caracteres como máximo. Por ejemplo: java, spring boot.',
      path: 'La ruta no se puede cambiar. Para usar otro archivo, quita este modelo y registra el nuevo.',
    },
    editPage: {
      meta: { title: 'Editar modelo' },
      heading: 'Editar modelo',
      back: '← Volver a los modelos',
      submit: 'Guardar cambios',
      notFoundTitle: 'No se encontró el modelo',
      notFoundBody: 'Puede que se haya quitado del registro. Vuelve a la lista para ver los modelos que hay.',
    },
    problemTitle: 'No se pudo completar la operación',
    warningTitle: 'Aviso',
    notices: {
      registered: 'Modelo registrado.',
      updated: 'Cambios guardados.',
      removed: 'Modelo quitado del registro. El archivo sigue en tu carpeta.',
      invalid_input: 'El formulario no es válido. No se guardó nada.',
      invalid_name: 'El nombre es obligatorio y puede tener hasta 120 caracteres, sin saltos de línea.',
      invalid_kind: 'Elige si es un CV o una carta de presentación.',
      invalid_language: 'Elige el idioma: español o inglés.',
      invalid_tags: 'Las etiquetas no son válidas. Sepáralas con comas y usa solo texto.',
      too_many_tags: 'Hay demasiadas etiquetas: el máximo es 12.',
      tag_too_long: 'Alguna etiqueta es demasiado larga: el máximo es de 40 caracteres.',
      invalid_note: 'La nota es demasiado larga (máximo 500 caracteres) o contiene caracteres no permitidos.',
      invalid_path: 'La ruta del archivo no es válida. Solo se aceptan archivos dentro de tu carpeta de modelos.',
      not_pdf: 'Solo se pueden registrar archivos PDF.',
      already_registered: 'Ese archivo ya está registrado como modelo.',
      outside_library: 'Ese archivo queda fuera de tu carpeta de modelos, así que no se puede usar.',
      file_not_found: 'No se encontró ese archivo en tu carpeta de modelos.',
      not_a_file: 'Esa ruta no es un archivo.',
      empty_file: 'Ese archivo está vacío.',
      too_large: 'Ese archivo es demasiado grande: el máximo es de 50 MB.',
      unreadable: 'No se pudo leer ese archivo.',
      model_not_found: 'Ese modelo no existe. Puede que ya se haya quitado.',
      library_unavailable:
        'No se puede leer la carpeta de modelos. Comprueba que existe y que la ruta configurada es correcta.',
      registry_unavailable:
        'No se pudo leer el registro de modelos. No se ha modificado nada; revisa el archivo de registro o los registros del servidor.',
    } as Readonly<Record<CvModelNoticeCode, string>>,
  },

  /*
   * Suggested CV category: an evidence-backed recommendation only. It never
   * names a registered model or file and never selects anything.
   */
  cvCategory: {
    heading: 'Categoría de CV sugerida',
    names: CV_CATEGORY_NAME,
    evidence: (terms: string) => `Términos detectados: ${terms}`,
    noEvidence: 'Sin evidencia suficiente en el título ni en la descripción.',
    tie: (categories: string) => `Empate entre ${categories}`,
    disclaimer: 'Orientativa: no selecciona ni asigna ningún modelo de CV.',
  },

  /* Gmail proposals ----------------------------------------------------- */
  mail: {
    accept: {
      accepted: 'Estado actualizado. Puedes deshacerlo en el historial.',
      accepted_untracked: 'Estado actualizado, pero la propuesta no se pudo marcar como aceptada.',
      conflict: 'Ya estaba aplicado o lo cambiaste tú después. No se tocó nada.',
      already_decided: 'Esta propuesta ya estaba resuelta.',
      application_not_found: 'La postulación de esa propuesta ya no existe.',
      refused: 'No se pudo aplicar el cambio.',
      not_found: 'Esa propuesta no existe.',
    },
    dismiss: {
      dismissed: 'Propuesta descartada.',
      not_found: 'Esa propuesta no existe.',
      already_decided: 'Esta propuesta ya estaba resuelta.',
    },
    run: {
      not_configured: 'El correo no está configurado.',
      auth_expired: 'Google rechazó el permiso (caduca cada 7 días). Renuévalo.',
      network: 'Sin conexión con Gmail.',
      rate_limited: 'Gmail pide esperar; reinténtalo más tarde.',
      server: 'Gmail no responde.',
      bad_response: 'Gmail respondió algo inesperado.',
      failed: 'Falló la revisión del correo. Mira el registro.',
      already_running: 'Ya hay una revisión en curso.',
      not_due: 'Al día.',
      cooldown: 'Se reintentará más tarde.',
      state_corrupt:
        'El estado del correo está dañado. Mueve el archivo de estado del correo a otra carpeta y reinténtalo.',
      ok: 'Correo revisado.',
    },
    token: {
      expiring: 'El permiso de Google caduca en menos de 24 horas.',
      expired: 'El permiso de Google ha caducado. Renuévalo para seguir leyendo el correo.',
    },
    status: {
      heading: 'Propuestas del correo',
      empty: 'No hay propuestas pendientes del correo.',
    },
    labels: {
      accept: 'Aceptar',
      dismiss: 'Descartar',
      checkNow: 'Revisar correo ahora',
    },
  },

  /* Lookups ------------------------------------------------------------- */
  status: STATUS,
  outcomeOption: OUTCOME,
  cvVariant: CV_VARIANT,
  workMode: WORK_MODE,
  english: ENGLISH,
  dimension: DIMENSION,
  actionResult: ACTION_RESULT,
} as const;

/** Falls back to the raw server text if an untranslated message ever appears. */
export function translateActionMessage(message: string): string {
  return ACTION_RESULT[message as ActionMessage] ?? message;
}

/** Spanish label for a CV variant, tolerant of a value the UI does not know. */
export function cvVariantLabel(variant: string): string {
  return CV_VARIANT[variant as CvVariant] ?? variant;
}

/** Spanish label for a score dimension, tolerant of a newly added dimension. */
export function dimensionLabel(dimension: string): string {
  return DIMENSION[dimension as ScoreDimension] ?? dimension;
}

/** Dates render in Spanish, in the timezone of the person reading them. */
export const LOCALE = 'es-ES';
