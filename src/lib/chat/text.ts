export const MAX_MESSAGE_LENGTH = 280;
/** Slow mode: one message per person in this window. */
export const SLOW_MODE_MS = 5_000;

/** Insults replaced by asterisks in chat messages (whole words, accents ignored). */
const MASKED = [
  'porra',
  'caralho',
  'buceta',
  'boceta',
  'cuzao',
  'arrombado',
  'arrombada',
  'fdp',
  'puta',
  'viado',
  'merda',
  'babaca',
  'otario',
  'otaria',
  'vagabundo',
  'vagabunda',
  'piranha',
  'corno',
  'desgracado',
  'desgracada',
];

/** Lowercase without accents. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Control, zero-width and bidirectional-override characters. */
const INVISIBLE = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f]/g;

/**
 * Links and contact handles are refused: they are the usual vehicle for spam, scams and
 * disinformation in a busy public chat.
 */
const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|br|io|me|ly|gl|app|info|xyz|site|online|link|tv|co)\b|wa\.me|t\.me|chat\.whatsapp)/i;

export type CleanResult = { text: string } | { error: string };

/** Normalizes a chat message, or explains why it cannot be sent. */
export function cleanMessage(input: unknown): CleanResult {
  if (typeof input !== 'string') return { error: 'Escreva uma mensagem.' };
  // One line, no invisible characters, no runs of spaces.
  const text = input.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'Escreva uma mensagem.' };
  if (text.length > MAX_MESSAGE_LENGTH)
    return { error: `Use no máximo ${MAX_MESSAGE_LENGTH} caracteres.` };
  if (LINK.test(fold(text))) return { error: 'Links não são permitidos no chat.' };
  if (/(.)\1{9,}/u.test(text)) return { error: 'Evite repetir o mesmo caractere.' };
  return { text: maskInsults(text) };
}

/** Replaces listed insults, as whole words, with asterisks of the same length. */
export function maskInsults(text: string) {
  return text.replace(/[\p{L}\p{N}]+/gu, (word) =>
    MASKED.includes(fold(word)) ? '*'.repeat(word.length) : word,
  );
}
