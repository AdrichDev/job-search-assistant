import { ES, cvVariantLabel } from '@/copy/es';
import { resolveModel, type ModelCatalog } from '@/server/model-catalog';

/**
 * What the "Documentos" column of the tracking table shows for one application:
 * the CV model and the letter model by NAME (resolved through the registry),
 * or, when there is no CV model but the legacy CV variant exists, that variant.
 * Pure: the registry is read once per page by the caller.
 */

export interface DocumentRefsView {
  readonly cvVariant?: string;
  readonly cvModelId?: string;
  readonly letterModelId?: string;
}

export interface DocumentLine {
  readonly label: string;
  readonly text: string;
  /** `warning`: the model is not (or no longer) available; `legacy`: the old lane-based CV. */
  readonly tone: 'normal' | 'warning' | 'legacy';
}

function modelLine(label: string, id: string, catalog: ModelCatalog): DocumentLine {
  const ref = resolveModel(catalog, id);
  return { label, text: ref.text, tone: ref.state === 'found' ? 'normal' : 'warning' };
}

export function describeDocuments(refs: DocumentRefsView | undefined, catalog: ModelCatalog): DocumentLine[] {
  if (refs === undefined) {
    return [];
  }
  const lines: DocumentLine[] = [];
  const labels = ES.tracking.documents;
  if (refs.cvModelId !== undefined) {
    lines.push(modelLine(labels.cv, refs.cvModelId, catalog));
  } else if (refs.cvVariant !== undefined) {
    lines.push({
      label: labels.cv,
      text: labels.legacyVariant(cvVariantLabel(refs.cvVariant)),
      tone: 'legacy',
    });
  }
  if (refs.letterModelId !== undefined) {
    lines.push(modelLine(labels.letter, refs.letterModelId, catalog));
  }
  return lines;
}
