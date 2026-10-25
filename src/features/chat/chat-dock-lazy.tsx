'use client';

import nextDynamic from 'next/dynamic';

/** Loads the chat chunk after hydration so election first paint stays light. */
export const ChatDockLazy = nextDynamic(
  () => import('./chat').then((module) => ({ default: module.ChatDock })),
  { ssr: false },
);
