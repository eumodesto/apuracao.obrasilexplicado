import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileAccessStore, PostgresAccessStore } from '../src/lib/access/store';
import type { AccessStore } from '../src/lib/access/types';
import { MemoryChatBus } from '../src/lib/chat/bus';
import { sendMessage, sendSticker, type ChatRuntime } from '../src/lib/chat/service';
import { STICKERS } from '../src/lib/chat/stickers';
import { MemoryChatStore } from '../src/lib/chat/store';
import {
  FilePhotoStore,
  PHOTO_SIZE,
  photoKey,
  photoRef,
  PostgresPhotoStore,
  processPhoto,
  validPhotoKey,
  type PhotoStore,
} from '../src/lib/profile/photo';

const T0 = Date.parse('2026-10-25T17:00:00-03:00');
const PG = process.env.TEST_DATABASE_URL;
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

afterEach(() => vi.unstubAllEnvs());

const photo = (width: number, height: number, format: 'png' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#c8102e' } })
    [format]()
    .toBuffer();

describe('profile photos', () => {
  it('become a 256 px JPEG square without metadata', async () => {
    const input = await sharp(await photo(1200, 800))
      .withMetadata({ exif: { IFD0: { Copyright: 'segredo' } } })
      .jpeg()
      .toBuffer();
    const output = await processPhoto(input);
    expect(output).not.toBeNull();
    const meta = await sharp(output!).metadata();
    expect(meta).toMatchObject({ format: 'jpeg', width: PHOTO_SIZE, height: PHOTO_SIZE });
    expect(meta.exif).toBeUndefined();
    expect(await processPhoto(await photo(300, 900, 'webp'))).not.toBeNull();
  });

  it('refuse anything that is not an image', async () => {
    expect(await processPhoto(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(await processPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]))).toBeNull();
  });

  it('have a stable, unguessable address that never shows the account id', () => {
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    const key = photoKey('google:123');
    expect(validPhotoKey(key)).toBe(true);
    expect(photoKey('google:123')).toBe(key);
    expect(photoKey('google:124')).not.toBe(key);
    expect(key).not.toContain('123');
    expect(photoRef({ id: 'google:123', photoVersion: null })).toBeNull();
    expect(photoRef({ id: 'google:123', photoVersion: 36 })).toBe(`${key}.10`);
    expect(validPhotoKey('../../etc/passwd')).toBe(false);
  });
});

function photoStoreSuite(name: string, make: () => PhotoStore) {
  it(`${name}: saves, replaces and removes`, async () => {
    const store = make();
    const key = `${run}0000000000000000000000`.slice(0, 24);
    expect(await store.get(key)).toBeNull();
    await store.put(key, Buffer.from('um'));
    await store.put(key, Buffer.from('dois'));
    expect((await store.get(key))?.toString()).toBe('dois');
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
  });
}

describe('photo storage', () => {
  photoStoreSuite('memory', () => new FilePhotoStore());
  if (PG) photoStoreSuite('Postgres', () => new PostgresPhotoStore(PG));
});

function accountSuite(name: string, make: () => AccessStore) {
  it(`${name}: records the photo version and forgets it on deletion`, async () => {
    const store = make();
    const id = `g:photo-${run}`;
    await store.upsertUser({ id, email: `f-${run}@example.com`, name: 'Fábio' });
    expect((await store.getUser(id))?.photoVersion).toBeNull();
    await store.setPhoto(id, T0);
    expect((await store.getUser(id))?.photoVersion).toBe(T0);
    await store.setPhoto(id, null);
    expect((await store.getUser(id))?.photoVersion).toBeNull();
    await store.setPhoto(id, T0);
    await store.anonymize(id, T0);
    expect((await store.getUser(id))?.photoVersion).toBeNull();
  });
}

describe('account photo', () => {
  accountSuite('file store', () => new FileAccessStore());
  if (PG) accountSuite('Postgres', () => new PostgresAccessStore(PG));
});

describe('stickers', () => {
  const state = (): ChatRuntime => ({
    bus: new MemoryChatBus(),
    store: new MemoryChatStore(),
    history: null,
    connections: 0,
    online: null,
  });
  const ana = { userId: 'google:ana', username: 'ana', party: 'PT', photo: 'abc.1' };

  it('are sent with the author photo and count for slow mode', async () => {
    const chat = state();
    const sent = await sendSticker(ana, '13-lingua', chat, T0);
    expect(sent).toMatchObject({
      ok: true,
      message: { username: 'ana', photo: 'abc.1', sticker: '13-lingua', text: 'Língua de fora' },
    });
    expect(await sendMessage(ana, 'logo depois', chat, T0 + 1_000)).toMatchObject({ status: 429 });
  });

  it('must come from the available packs', async () => {
    expect(await sendSticker(ana, 'rosto-candidato', state(), T0)).toMatchObject({ status: 400 });
    expect(await sendSticker(ana, { id: '13-lingua' }, state(), T0)).toMatchObject({ status: 400 });
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
  });
});
