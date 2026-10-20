import type { CvModelKind, CvModelLanguage, CvModelRepository } from '@job-queue/core';
import { ES } from '@/copy/es';

/**
 * The registry of CV and letter models as the UI needs it: read ONCE per page
 * load, then used to turn stored ids into names.
 *
 * Applications store only the id (a reference, never a copy), so a name is
 * resolved at display time and an id can dangle when the model was removed from
 * the registry. Nothing here ever carries an error message or a path: a failing
 * registry becomes `unavailable: true` and the page words it in Spanish.
 *
 * Free of `server-only` on purpose: the pure helpers are used by components.
 */

export interface CatalogModel {
  readonly id: string;
  readonly name: string;
  readonly kind: CvModelKind;
  readonly language: CvModelLanguage;
}

export interface ModelCatalog {
  readonly models: readonly CatalogModel[];
  /** The registry could not be read: names are unknown, which is not "removed". */
  readonly unavailable: boolean;
}

export const EMPTY_CATALOG: ModelCatalog = { models: [], unavailable: false };

/** One `list()` call. Never throws. No repository configured = an empty registry. */
export async function loadModelCatalog(repository: CvModelRepository | undefined): Promise<ModelCatalog> {
  if (repository === undefined) {
    return EMPTY_CATALOG;
  }
  try {
    const models = await repository.list();
    return {
      models: models.map(({ id, name, kind, language }) => ({ id, name, kind, language })),
      unavailable: false,
    };
  } catch {
    return { models: [], unavailable: true };
  }
}

export interface ModelRef {
  readonly state: 'found' | 'dangling' | 'unavailable';
  readonly text: string;
}

/** Name of a stored id, or the Spanish reason there is none. Never the raw id. */
export function resolveModel(catalog: ModelCatalog, id: string): ModelRef {
  const found = catalog.models.find((model) => model.id === id);
  if (found !== undefined) {
    return { state: 'found', text: found.name };
  }
  return catalog.unavailable
    ? { state: 'unavailable', text: ES.models.nameUnavailable }
    : { state: 'dangling', text: ES.models.notRegisteredAnymore };
}

export interface ModelOption {
  readonly value: string;
  readonly label: string;
}

export interface ModelSelect {
  readonly options: readonly ModelOption[];
  /** No model of this kind and nothing stored: there is nothing to choose. */
  readonly disabled: boolean;
  /** The registry could not be read (the stored id is kept as the only choice). */
  readonly unavailable: boolean;
  /** The registry has no model of this kind. */
  readonly empty: boolean;
}

/**
 * Options of one model select. First option empty ("Sin modelo"); then the
 * registry's models of the kind. A stored id that is NOT among them (removed
 * from the registry, or of another kind) is kept as an extra, clearly labelled
 * option so pre-filling it and saving an unrelated edit cannot blank it.
 */
export function buildModelSelect(catalog: ModelCatalog, kind: CvModelKind, storedId: string): ModelSelect {
  const ofKind = catalog.models.filter((model) => model.kind === kind);
  const options: ModelOption[] = [
    { value: '', label: ES.edit.fields.noModel },
    ...ofKind.map((model) => ({
      value: model.id,
      label: `${model.name} (${ES.models.languages[model.language]})`,
    })),
  ];
  if (storedId !== '' && !ofKind.some((model) => model.id === storedId)) {
    options.push({
      value: storedId,
      label: catalog.unavailable
        ? `${ES.models.nameUnavailable} (${storedId})`
        : ES.edit.fields.danglingModel(storedId),
    });
  }
  const empty = ofKind.length === 0;
  return {
    options,
    disabled: empty && storedId === '',
    unavailable: catalog.unavailable,
    empty,
  };
}
