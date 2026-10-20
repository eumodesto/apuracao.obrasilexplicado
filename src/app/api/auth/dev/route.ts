import { NextResponse } from 'next/server';
import { devLoginEnabled } from '@/lib/access/config';
import { signIn } from '@/lib/access/auth';
import { safeNext } from '@/lib/access/google';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Test login for `next dev` without Google credentials. Absent in production.
 * Each e-mail stands in for a different Google account.
 */
export async function POST(request: Request) {
  if (!devLoginEnabled() || !fromThisComputer(request)) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const typed = String(form?.get('email') ?? '')
    .trim()
    .toLowerCase();
  const email = /^[^\s@]+@[^\s@]+$/.test(typed) ? typed : 'teste@localhost';
  const profile = { sub: `dev:${email}`, email, name: email.split('@')[0] };
  await signIn(profile);
  // Relative, so the browser stays on the host it used (localhost vs 127.0.0.1).
  const next = safeNext(String(form?.get('next') ?? '/'));
  return new NextResponse(null, { status: 303, headers: { Location: next } });
}

/**
 * Only when the page was opened as localhost: a site pointing its own domain at this computer
 * (DNS rebinding) cannot use the test login. The dev server itself listens only on 127.0.0.1.
 */
function fromThisComputer(request: Request) {
  const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
