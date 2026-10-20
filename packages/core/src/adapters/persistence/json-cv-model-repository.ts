import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createJsonLogStore } from './json-log-store.js';
import {
  CV_MODEL_KINDS,
  CV_MODEL_LANGUAGES,
  CV_MODEL_LIMITS,
  applyCvModelPatch,
  checkRelativePath,
  createCvModel,
  normalizeTags,
  relativePathKey,
  type CvModel,
  type CvModelDraft,
  type CvModelPatch,
} from '../../domain/cv-model.js';
import type {
  AddCvModelResult,
  CvModelRepository,
  UpdateCvModelResult,
} from '../../ports/cv-model-repository.js';

/**
 * JSON-file registry of CV and letter models (`{ version: 1, models: [...] }`).
 *
 * Plumbing (atomic writes, serialised cycles, refusal to overwrite a file it
 * cannot parse) comes from `json-log-store.ts`. A hand-edited registry is not
 * trusted: every stored path is re-checked with the same rule used at
 * registration, so a tampered `../../x.pdf` makes the file unreadable instead of
 * becoming a path the app would serve.
 */

const isoDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const modelSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(CV_MODEL_LIMITS.nameMin).max(CV_MODEL_LIMITS.nameMax),
  kind: z.enum(CV_MODEL_KINDS),
  language: z.enum(CV_MODEL_LANGUAGES),
  tags: z.array(z.string()),
  relativePath: z.string().refine((value) => {
    const checked = checkRelativePath(value);
    return checked.ok && checked.path === value;
  }, 'unsafe or non-canonical relative path'),
  registeredAt: isoDate,
  note: z.string().max(CV_MODEL_LIMITS.noteMax).optional(),
});

export interface JsonCvModelRepositoryOptions {
  readonly filePath: string;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

function serialize(model: CvModel) {
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    language: model.language,
    tags: [...model.tags],
    relativePath: model.relativePath,
    registeredAt: model.registeredAt.toISOString(),
    ...(model.note === undefined ? {} : { note: model.note }),
  };
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });

function byName(a: CvModel, b: CvModel): number {
  return collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

export function createJsonCvModelRepository(
  options: JsonCvModelRepositoryOptions,
): CvModelRepository {
  const newId = options.newId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  const store = createJsonLogStore({
    filePath: options.filePath,
    label: 'CV model registry',
    entriesKey: 'models',
    entrySchema: modelSchema,
    revive: (raw): CvModel => {
      const tags = normalizeTags(raw.tags);
      return createCvModel({
        id: raw.id,
        registeredAt: raw.registeredAt,
        draft: {
          name: raw.name,
          kind: raw.kind,
          language: raw.language,
          tags: tags.ok ? tags.tags : [],
          relativePath: raw.relativePath,
          ...(raw.note === undefined ? {} : { note: raw.note }),
        },
      });
    },
    serialize,
  });

  return {
    async list(): Promise<readonly CvModel[]> {
      const models = await store.exclusive(store.readAll);
      return [...models].sort(byName);
    },

    async find(id: string): Promise<CvModel | null> {
      const models = await store.exclusive(store.readAll);
      return models.find((model) => model.id === id) ?? null;
    },

    async add(draft: CvModelDraft): Promise<AddCvModelResult> {
      return store.exclusive(async () => {
        const models = await store.readAll();
        const key = relativePathKey(draft.relativePath);
        const existing = models.find((model) => relativePathKey(model.relativePath) === key);
        if (existing !== undefined) {
          return { status: 'already_registered', existingId: existing.id } as const;
        }

        const model = createCvModel({ id: newId(), registeredAt: now(), draft });
        await store.writeAll([...models, model]);
        return { status: 'added', model } as const;
      });
    },

    async update(id: string, patch: CvModelPatch): Promise<UpdateCvModelResult> {
      return store.exclusive(async () => {
        const models = await store.readAll();
        const index = models.findIndex((model) => model.id === id);
        const current = models[index];
        if (current === undefined) {
          return { status: 'not_found' } as const;
        }

        const updated = applyCvModelPatch(current, patch);
        const next = [...models];
        next[index] = updated;
        await store.writeAll(next);
        return { status: 'updated', model: updated } as const;
      });
    },

    async remove(id: string): Promise<boolean> {
      return store.exclusive(async () => {
        const models = await store.readAll();
        const next = models.filter((model) => model.id !== id);
        if (next.length === models.length) {
          return false;
        }
        await store.writeAll(next);
        return true;
      });
    },
  };
}
