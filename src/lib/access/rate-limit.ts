import { chat } from '@/lib/chat/service';

/**
 * At most `limit` uses of `key` per window, shared across servers through the chat bus (Redis
 * when configured). Each use takes one of the window's numbered slots.
 */
export async function allow(key: string, limit: number, windowMs: number, now = Date.now()) {
  const window = Math.floor(now / windowMs);
  const { bus } = chat();
  for (let slot = 0; slot < limit; slot++)
    if (await bus.claim(`rate:${key}:${window}:${slot}`, windowMs * 2)) return true;
  return false;
}

/** The visitor's address as set by the reverse proxy (Caddy replaces any forged value). */
export const clientIp = (request: Request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
