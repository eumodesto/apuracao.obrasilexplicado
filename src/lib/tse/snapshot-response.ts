import { createHash } from 'node:crypto';
import { gzip, gzipSync } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/** Frames above this size are sent compressed to clients that accept gzip. */
const GZIP_MIN_BYTES = 32768;
/** Identity bodies above this size are streamed in chunks instead of one buffer. */
const STREAM_ABOVE_BYTES = 4_000_000;

/** A payload serialized once: JSON bytes, their gzip, and the ETag of each variant. */
export type EncodedSnapshot = {
  identity: Uint8Array;
  gzip: Uint8Array | null;
  etagIdentity: string;
  etagGzip: string;
};

function finish(text: string, compressed: Uint8Array | null): EncodedSnapshot {
  const hash = createHash('sha256').update(text);
  const etagIdentity = '"' + hash.copy().update('identity').digest('hex') + '"';
  const etagGzip = '"' + hash.update('gzip').digest('hex') + '"';
  return { identity: new TextEncoder().encode(text), gzip: compressed, etagIdentity, etagGzip };
}

/** Synchronous encoding, for small payloads and tests. */
export function encodeSnapshot(payload: unknown): EncodedSnapshot {
  const text = JSON.stringify(payload);
  return finish(text, text.length > GZIP_MIN_BYTES ? new Uint8Array(gzipSync(text)) : null);
}

/** Same, but compresses on the thread pool so it never blocks the event loop. */
export async function encodeSnapshotAsync(payload: unknown): Promise<EncodedSnapshot> {
  const text = JSON.stringify(payload);
  return finish(
    text,
    text.length > GZIP_MIN_BYTES ? new Uint8Array(await gzipAsync(text)) : null,
  );
}

const acceptsGzip = (request: Request) =>
  (request.headers.get('accept-encoding') ?? '')
    .split(',')
    .some((value) => /^\s*gzip\s*(?:;\s*q=(?:1(?:\.0*)?|0\.[1-9]\d*))?\s*$/.test(value));

/** Builds the HTTP answer (304, gzip, buffer or stream) from an already encoded payload. */
export function respondSnapshot(request: Request, encoded: EncodedSnapshot) {
  const gzipped = encoded.gzip !== null && acceptsGzip(request);
  const etag = gzipped ? encoded.etagGzip : encoded.etagIdentity;
  const headers = new Headers({
    ETag: etag,
    'Cache-Control': 'private, no-cache',
    Vary: 'Accept-Encoding',
  });
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (gzipped) {
    headers.set('Content-Encoding', 'gzip');
    return new Response(encoded.gzip as Uint8Array<ArrayBuffer>, { headers });
  }
  const bytes = encoded.identity;
  if (bytes.length <= STREAM_ABOVE_BYTES) return new Response(bytes as Uint8Array<ArrayBuffer>, { headers });
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        const end = Math.min(offset + 65536, bytes.length);
        controller.enqueue(bytes.subarray(offset, end));
        offset = end;
      },
    }),
    { headers },
  );
}

/** A JSON answer with its own headers and ETag, serialized and gzipped once per shared window. */
export type SharedBody = {
  identity: Uint8Array;
  gzip: Uint8Array | null;
  etagIdentity: string;
  etagGzip: string;
  headers: Record<string, string>;
};

/** `etag` is quoted; the gzip variant gets its own so caches never mix the two encodings. */
export async function encodeBody(
  text: string,
  etag: string,
  headers: Record<string, string>,
  gzipMinBytes = 1024,
): Promise<SharedBody> {
  const bytes = new TextEncoder().encode(text);
  return {
    identity: bytes,
    gzip: bytes.length >= gzipMinBytes ? new Uint8Array(await gzipAsync(bytes)) : null,
    etagIdentity: etag,
    etagGzip: etag.slice(0, -1) + '-gzip"',
    headers,
  };
}

/** 304 / gzip / identity answer for a `SharedBody`; Caddy then has nothing left to compress. */
export function respondBody(request: Request, body: SharedBody) {
  const gzipped = body.gzip !== null && acceptsGzip(request);
  const etag = gzipped ? body.etagGzip : body.etagIdentity;
  const headers = new Headers({ ...body.headers, ETag: etag, Vary: 'Accept-Encoding' });
  if (request.headers.get('if-none-match') === etag)
    return new Response(null, { status: 304, headers });
  headers.set('Content-Type', 'application/json');
  if (gzipped) {
    headers.set('Content-Encoding', 'gzip');
    return new Response(body.gzip as Uint8Array<ArrayBuffer>, { headers });
  }
  return new Response(body.identity as Uint8Array<ArrayBuffer>, { headers });
}

/** Full municipal frames must stay within the hosting response limit. */
export function snapshotResponse(request: Request, payload: unknown) {
  return respondSnapshot(request, encodeSnapshot(payload));
}

type Entry = { value: unknown; at: number };
const shared = globalThis as {
  __sharedValues?: Map<string, Entry>;
  __sharedFlights?: Map<string, Promise<unknown>>;
};
const entries = (shared.__sharedValues ??= new Map());
const flights = (shared.__sharedFlights ??= new Map());
const MAX_ENTRIES = 256;
/** Past this age an entry is no longer served while refreshing: the caller waits for fresh data. */
const MAX_STALE_MS = 60_000;

/**
 * Election answers are identical for every viewer and change every ~30 s, yet thousands of
 * viewers ask for them every few seconds. Rebuilding, serializing, hashing and compressing them
 * per request starved the event loop: logins, access checks and the admin panel stalled behind
 * it. Here a value is built once per `ttlMs` (single flight per key); viewers inside that window
 * get the stored result, and an expired one is served while it refreshes in the background.
 * The TSE polling and its own schedule are untouched. Never use it for per-user data.
 */
export async function sharedValue<T>(
  key: string,
  ttlMs: number,
  build: () => Promise<T>,
  now = Date.now,
): Promise<T> {
  const hit = entries.get(key);
  if (hit && now() - hit.at < ttlMs) return hit.value as T;
  let flight = flights.get(key) as Promise<T> | undefined;
  if (!flight) {
    flight = (async () => {
      const value = await build();
      entries.set(key, { value, at: now() });
      if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      return value;
    })().finally(() => flights.delete(key));
    flights.set(key, flight);
  }
  if (hit && now() - hit.at < MAX_STALE_MS) {
    flight.catch(() => {});
    return hit.value as T;
  }
  return flight;
}

/** A payload serialized and compressed once per window; see `sharedValue`. */
export const cachedSnapshot = (
  key: string,
  ttlMs: number,
  build: () => Promise<unknown>,
  now = Date.now,
) => sharedValue(key, ttlMs, async () => encodeSnapshotAsync(await build()), now);

export async function cachedSnapshotResponse(
  request: Request,
  key: string,
  ttlMs: number,
  build: () => Promise<unknown>,
) {
  return respondSnapshot(request, await cachedSnapshot(key, ttlMs, build));
}