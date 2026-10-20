import 'server-only';

import type { CvModelDeps } from '@job-queue/core';

/**
 * Serves one registered model PDF.
 *
 * The id is only ever a KEY into the registry: it is looked up, never joined
 * into a path. The file is then opened through the library's safe resolver, so
 * a tampered registry entry, a moved file or a link out of the folder all end
 * as a plain 404. Neither body ever names a path or a file.
 *
 * Ranges are not supported, on purpose and visibly: `Accept-Ranges: none`, and
 * every GET answers 200 with the whole file. HEAD answers the same headers with
 * no body. This function takes no request headers, so a `Range` header cannot
 * affect it.
 */

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
} as const;

function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: TEXT_HEADERS });
}

/** ASCII-only, header-safe download name derived from the model's display name. */
export function safeDownloadName(name: string): string {
  const stem = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 59);
  return `${stem.length === 0 ? 'modelo' : stem}.pdf`;
}

const NOT_FOUND = 'No se encontró el documento.';

export async function servePdf(
  id: string,
  method: 'GET' | 'HEAD',
  deps: CvModelDeps,
): Promise<Response> {
  if (id.length === 0 || id.length > 200) {
    return plain(404, NOT_FOUND);
  }

  let model;
  try {
    model = await deps.repository.find(id);
  } catch (cause) {
    deps.logger?.error(
      `CV model PDF: registry unreadable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return plain(503, 'El registro de modelos no está disponible ahora mismo.');
  }
  if (model === null) {
    return plain(404, NOT_FOUND);
  }

  const file = await deps.library.readModelFile(model.relativePath);
  if (file.status === 'refused') {
    deps.logger?.warn(`CV model PDF: model ${model.id} cannot be served (${file.reason}).`);
    return plain(404, NOT_FOUND);
  }

  const headers = {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${safeDownloadName(model.name)}"`,
    'Content-Length': String(file.bytes.length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'none',
  };
  return new Response(method === 'HEAD' ? null : new Uint8Array(file.bytes), {
    status: 200,
    headers,
  });
}
