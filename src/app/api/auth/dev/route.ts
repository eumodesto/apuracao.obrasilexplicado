import { NextResponse } from 'next/server';
import { signIn } from '@/lib/access/auth';
import { devLoginEnabled } from '@/lib/access/config';
import { safeNext } from '@/lib/access/next';
import { emailAccountId } from '@/lib/access/password';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Test login for `next dev` without a password. Absent in production.
 * Real e-mails use the same account id as password login (`email:…`), so admin/staff
 * do not end up with a second shadow account that steals the username.
 * Only `teste@localhost` keeps the throwaway `dev:` prefix.
 */
export async function POST(request: Request) {
  if (!devLoginEnabled() || !fromThisComputer(request)) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const typed = String(form?.get('email') ?? '')
    .trim()
    .toLowerCase();
  const email = /^[^\s@]+@[^\s@]+$/.test(typed) ? typed : 'teste@localhost';
  const sub = email === 'teste@localhost' ? `dev:${email}` : emailAccountId(email);
  const profile = { sub, email, name: email.split('@')[0] };
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
