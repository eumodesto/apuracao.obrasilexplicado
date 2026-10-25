import { NextResponse } from 'next/server';
import { safeNext } from '@/lib/access/next';
import { endSession } from '@/lib/access/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  await endSession();
  // Relative, so the browser stays on the host it used (localhost vs 127.0.0.1).
  // Optional ?next= brings the person back after signing in again (e.g. /admin).
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  // Back to the panel as a new visitor — not the login modal.
  const location = next === '/' ? '/' : `/login?next=${encodeURIComponent(next)}`;
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}
