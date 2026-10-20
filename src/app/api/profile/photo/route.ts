import { currentAccess, forgetAccess, sessionProblem } from '@/lib/access/guard';
import { readSession } from '@/lib/access/session';
import { accessStore } from '@/lib/access/store';
import { sameOrigin } from '@/lib/admin/guard';
import { chat } from '@/lib/chat/service';
import {
  MAX_UPLOAD_BYTES,
  photoKey,
  photoRef,
  photoStore,
  photoUrl,
  processPhoto,
} from '@/lib/profile/photo';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One photo change per person in this window. */
const PHOTO_COOLDOWN_MS = 5_000;

async function account(request: Request) {
  if (!sameOrigin(request))
    return { problem: Response.json({ error: 'Origem não permitida.' }, { status: 403 }) };
  const access = await currentAccess(await readSession(), undefined, undefined, { fresh: true });
  const problem = sessionProblem(access);
  return problem || !access ? { problem: problem! } : { user: access.user };
}

/** Saves a new profile photo: the raw image as the request body. */
export async function POST(request: Request) {
  const found = await account(request);
  if ('problem' in found) return found.problem;
  const { user } = found;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES)
    return Response.json({ error: 'Foto muito grande.' }, { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (!body.length || body.length > MAX_UPLOAD_BYTES)
    return Response.json({ error: 'Envie uma foto de até 8 MB.' }, { status: 413 });
  if (!(await chat().bus.claim(`photo:${user.id}`, PHOTO_COOLDOWN_MS)))
    return Response.json({ error: 'Espere alguns segundos e tente de novo.' }, { status: 429 });
  const photo = await processPhoto(body);
  if (!photo) return Response.json({ error: 'Não foi possível ler essa imagem.' }, { status: 400 });
  await photoStore().put(photoKey(user.id), photo);
  const version = Date.now();
  await accessStore().setPhoto(user.id, version);
  forgetAccess(user.id);
  const ref = photoRef({ id: user.id, photoVersion: version });
  return Response.json({ photo: ref, url: photoUrl(ref) });
}

/** Removes the profile photo. */
export async function DELETE(request: Request) {
  const found = await account(request);
  if ('problem' in found) return found.problem;
  await photoStore().remove(photoKey(found.user.id));
  await accessStore().setPhoto(found.user.id, null);
  forgetAccess(found.user.id);
  return Response.json({ photo: null, url: null });
}
