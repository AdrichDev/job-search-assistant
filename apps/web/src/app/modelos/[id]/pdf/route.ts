import { cvModelDeps } from '@/server/container';
import { servePdf } from '@/server/cv-model-pdf';

/** Read-only and per-request: the registry and the files change outside the app. */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return servePdf(id, 'GET', cvModelDeps());
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return servePdf(id, 'HEAD', cvModelDeps());
}
