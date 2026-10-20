import { NextResponse } from 'next/server';
import { devLoginEnabled } from '@/lib/access/config';
import { startSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Test login for `next dev` without Google credentials. Absent in production. */
export async function POST() {
  if (!devLoginEnabled()) return new Response(null, { status: 404 });
  const profile = { sub: 'dev:local', email: 'teste@localhost', name: 'Visitante de teste' };
  await accessStore().upsertUser({ id: profile.sub, email: profile.email, name: profile.name });
  await startSession(profile);
  // Relative, so the browser stays on the host it used (localhost vs 127.0.0.1).
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
