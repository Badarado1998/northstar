import { dispatch } from '@/lib/routes';
import { endpoint } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request, context: { params: Promise<{ path: string[] }> }, method: string) {
  const { path } = await context.params;
  return endpoint(() => dispatch(request, method, path.join('/')));
}

export function GET(request: Request, context: { params: Promise<{ path: string[] }> }) { return handle(request, context, 'GET'); }
export function POST(request: Request, context: { params: Promise<{ path: string[] }> }) { return handle(request, context, 'POST'); }
export function DELETE(request: Request, context: { params: Promise<{ path: string[] }> }) { return handle(request, context, 'DELETE'); }
