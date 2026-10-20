'use client';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './avatar';

/** Side of the square sent to the server (it stores 256 px). */
const OUTPUT = 512;

type Shot = { blob: Blob; url: string };

/** Crops the center square of an image or video frame into a JPEG. */
function square(
  source: CanvasImageSource,
  width: number,
  height: number,
  mirror: boolean,
): Promise<Blob | null> {
  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUTPUT;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  // Selfie previews are mirrored; the saved photo matches what the person saw.
  if (mirror) {
    context.translate(OUTPUT, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    source,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    OUTPUT,
    OUTPUT,
  );
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}

/**
 * Profile photo: takes a picture with the camera right away (front camera on phones), or picks
 * one from the gallery, then shows it before saving.
 */
export function PhotoCapture({
  photo,
  name,
  color,
  onClose,
  onChange,
}: {
  photo: string | null;
  name: string;
  color: string;
  onClose: () => void;
  onChange: (photo: string | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'unavailable'>('starting');
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const media = navigator.mediaDevices;
    (media?.getUserMedia
      ? media.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } },
          audio: false,
        })
      : Promise.reject(new Error('no camera'))
    )
      .then((opened) => {
        if (!live) return opened.getTracks().forEach((track) => track.stop());
        stream.current = opened;
        if (video.current) video.current.srcObject = opened;
        setCamera('on');
      })
      .catch(() => live && setCamera('unavailable'));
    return () => {
      live = false;
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  // Frees the preview image when it is replaced or the dialog closes.
  useEffect(() => () => void (shot && URL.revokeObjectURL(shot.url)), [shot]);

  const keep = (blob: Blob | null) => {
    if (!blob) return setError('Não foi possível usar essa imagem.');
    setError(null);
    setShot({ blob, url: URL.createObjectURL(blob) });
  };

  const takePicture = async () => {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    keep(await square(element, element.videoWidth, element.videoHeight, true));
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      keep(await square(bitmap, bitmap.width, bitmap.height, false));
      bitmap.close();
    } catch {
      setError('Não foi possível abrir essa imagem.');
    }
  };

  const save = async (remove = false) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/profile/photo', {
        method: remove ? 'DELETE' : 'POST',
        headers: remove ? undefined : { 'Content-Type': 'image/jpeg' },
        body: remove ? undefined : shot?.blob,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setError(body.error ?? 'Não foi possível salvar a foto.');
      onChange(body.photo ?? null);
      onClose();
    } catch {
      setError('Falha de conexão. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="photo-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="photo-dialog" role="dialog" aria-modal="true" aria-labelledby="photo-title">
        <header className="photo-header">
          <h2 id="photo-title">Sua foto no chat</h2>
          <button type="button" className="chat-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>

        <div className="photo-stage">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="Prévia da sua nova foto" />
          ) : (
            <>
              <video
                ref={(element) => {
                  video.current = element;
                  // Re-attached after "Tirar outra" mounts a new element.
                  if (element && stream.current && element.srcObject !== stream.current)
                    element.srcObject = stream.current;
                }}
                autoPlay
                playsInline
                muted
                hidden={camera !== 'on'}
                aria-label="Câmera"
              />
              {camera !== 'on' && (
                <div className="photo-placeholder">
                  <Avatar photo={photo} name={name} color={color} size={120} />
                  <p>
                    {camera === 'starting'
                      ? 'Abrindo a câmera…'
                      : 'Não foi possível abrir a câmera. Escolha uma foto do aparelho.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}

        <div className="photo-actions">
          {shot ? (
            <>
              <button
                type="button"
                className="photo-primary"
                disabled={busy}
                onClick={() => save()}
              >
                {busy ? 'Salvando…' : 'Usar esta foto'}
              </button>
              <button type="button" className="photo-secondary" onClick={() => setShot(null)}>
                Tirar outra
              </button>
            </>
          ) : (
            <>
              {camera === 'on' && (
                <button type="button" className="photo-primary photo-shutter" onClick={takePicture}>
                  <span aria-hidden="true" />
                  Tirar foto
                </button>
              )}
              <button
                type="button"
                className={camera === 'on' ? 'photo-secondary' : 'photo-primary'}
                onClick={() => gallery.current?.click()}
              >
                Escolher da galeria
              </button>
              {photo && (
                <button
                  type="button"
                  className="photo-link"
                  disabled={busy}
                  onClick={() => save(true)}
                >
                  Remover foto atual
                </button>
              )}
            </>
          )}
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        <p className="photo-note">
          Sua foto aparece para todos no chat. Fotos ofensivas são removidas pela moderação.
        </p>
      </div>
    </div>
  );
}
