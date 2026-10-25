/**
 * Only one full floating panel on phones at a time (Chat vs Projeção). Desktop docked chat
 * can stay open while the compact projection widget is used.
 */
type Panel = 'chat' | 'projection';

const store = ((globalThis as { __floatPanels?: unknown }).__floatPanels ??= {
  open: null as Panel | null,
  listeners: new Set<() => void>(),
}) as { open: Panel | null; listeners: Set<() => void> };

const emit = () => store.listeners.forEach((listener) => listener());

export function claimPanel(id: Panel) {
  if (store.open === id) return;
  store.open = id;
  emit();
}

export function releasePanel(id: Panel) {
  if (store.open !== id) return;
  store.open = null;
  emit();
}

export function subscribePanels(listener: () => void) {
  store.listeners.add(listener);
  return () => void store.listeners.delete(listener);
}

export const openFloatingPanel = () => store.open;
