import { NextResponse } from 'next/server';
import { endSession } from '@/lib/access/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST() {
  await endSession();
  // Relative, so the browser stays on the host it used (localhost vs 127.0.0.1).
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
