'use client';
import { useState } from 'react';
import './avatar.css';

/**
 * Round profile photo, or the name's first letter on the party color when there is none (or it
 * was removed). `photo` is the "key.version" reference that chat messages carry.
 */
export function Avatar({
  photo,
  name,
  color,
  size = 36,
  className,
}: {
  photo: string | null;
  name: string;
  color: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.44),
    '--avatar': color,
  } as React.CSSProperties;
  const classes = className ? `avatar ${className}` : 'avatar';
  if (photo && failed !== photo)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={classes}
        style={style}
        src={`/api/chat/photo/${photo}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(photo)}
      />
    );
  return (
    <span className={`${classes} is-initial`} style={style} aria-hidden="true">
      {name.replace(/^@/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}
