export type Sticker = {
  id: string;
  /** Big symbol at the top (emoji, never a candidate's face). */
  emoji: string;
  text: string;
  /** Card gradient. */
  from: string;
  to: string;
};

/**
 * Free starter pack everyone with chat access can send. Paid packs (phase 2) join this list.
 * No candidate faces or names: only reactions to the count.
 */
export const STICKERS: Sticker[] = [
  { id: 'vai13', emoji: '🔴', text: 'Vai 13!', from: '#e0313f', to: '#8f0f1d' },
  { id: 'vai22', emoji: '🔵', text: 'Vai 22!', from: '#2f6fd6', to: '#123a7d' },
  { id: 'virou', emoji: '🔄', text: 'Virou!', from: '#f5a524', to: '#c2410c' },
  { id: 'apurando', emoji: '🗳️', text: 'Apurando…', from: '#0b6b3a', to: '#074c2b' },
  { id: 'tenso', emoji: '😬', text: 'Tá tenso', from: '#7c3aed', to: '#4c1d95' },
  { id: 'chocado', emoji: '😱', text: 'Não acredito!', from: '#ec4899', to: '#9d174d' },
  { id: 'festa', emoji: '🎉', text: 'Comemora!', from: '#16a34a', to: '#166534' },
  { id: 'pipoca', emoji: '🍿', text: 'Só observando', from: '#eab308', to: '#a16207' },
  { id: 'calma', emoji: '🧘', text: 'Calma, gente', from: '#0ea5e9', to: '#0369a1' },
  { id: 'empate', emoji: '⚖️', text: 'Empate técnico', from: '#64748b', to: '#334155' },
  { id: 'cafe', emoji: '☕', text: 'Mais um café', from: '#a16207', to: '#5b3410' },
  { id: 'brasil', emoji: '🇧🇷', text: 'Brasil!', from: '#0b6b3a', to: '#d4a40a' },
];

export const stickerById = (id: string | null | undefined) =>
  STICKERS.find((sticker) => sticker.id === id) ?? null;
