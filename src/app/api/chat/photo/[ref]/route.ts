import { photoStore, validPhotoKey } from '@/lib/profile/photo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Profile photo shown in the chat. The address ("key.version") changes with every new photo, so
 * browsers may keep each one; a removed photo answers 404 and the chat shows the initials.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const key = ref.split('.')[0];
  if (!validPhotoKey(key)) return new Response(null, { status: 404 });
  const data = await photoStore().get(key);
  if (!data) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': 'image/jpeg',
      // The address changes with every new photo, so each version never changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
