'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest('input, textarea, [contenteditable="true"]');

/**
 * The panel and the chat cannot be selected or copied (text, drag, long-press menu on phones).
 * Fields where people type keep working. The admin area is left alone: moderators copy e-mails
 * and ids there. This deters casual copying; it cannot stop screenshots or the developer tools.
 */
export function CopyGuard() {
  const pathname = usePathname();
  // Moderators copy e-mails and ids; people copy parts of the privacy policy.
  const guarded = !pathname.startsWith('/admin') && !pathname.startsWith('/privacidade');
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('no-copy', guarded);
    if (!guarded) return;
    const block = (event: Event) => {
      if (!typing(event.target)) event.preventDefault();
    };
    const events = ['copy', 'cut', 'dragstart', 'selectstart'] as const;
    events.forEach((name) => document.addEventListener(name, block));
    return () => {
      root.classList.remove('no-copy');
      events.forEach((name) => document.removeEventListener(name, block));
    };
  }, [guarded]);
  return null;
}
