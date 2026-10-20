import type { CvModel, CvModelDraft, CvModelPatch } from '../domain/cv-model.js';

/**
 * Driven port for the registry of CV and cover-letter models.
 *
 * The registry only records WHICH library files are models and what the person
 * calls them. `remove` therefore deletes the registry entry and nothing else:
 * the PDF belongs to the human and no port in this product can delete it.
 */

export type AddCvModelResult =
  | { readonly status: 'added'; readonly model: CvModel }
  | { readonly status: 'already_registered'; readonly existingId: string };

export type UpdateCvModelResult =
  | { readonly status: 'updated'; readonly model: CvModel }
  | { readonly status: 'not_found' };

export interface CvModelRepository {
  /** Every model, ordered by name (accent- and case-insensitive). */
  list(): Promise<readonly CvModel[]>;
  find(id: string): Promise<CvModel | null>;
  /** Mints the id and registration date. Refuses a path that is already registered. */
  add(draft: CvModelDraft): Promise<AddCvModelResult>;
  update(id: string, patch: CvModelPatch): Promise<UpdateCvModelResult>;
  /** True when an entry existed. Never touches the file. */
  remove(id: string): Promise<boolean>;
}
