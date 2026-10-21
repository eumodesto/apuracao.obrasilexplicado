/** Names that could pass as the platform, the TSE or a candidate. Compared without dots and _. */
const RESERVED = [
  'admin',
  'administrador',
  'administracao',
  'adm',
  'moderador',
  'moderacao',
  'mod',
  'suporte',
  'oficial',
  'equipe',
  'staff',
  'sistema',
  'root',
  'tse',
  'justicaeleitoral',
  'resultados',
  'resultadosbrasil',
  'obrasilexplicado',
  'lula',
  'bolsonaro',
  'flaviobolsonaro',
  'presidente',
];
/** Parts that mark a name as official anywhere inside it. */
// "visitante" is how people without an account appear in the chat ("Visitante 1234").
const RESERVED_PARTS = [
  'admin',
  'moderador',
  'suporte',
  'oficial',
  'resultadosbrasil',
  'visitante',
];
/** Offensive terms that are never part of an innocent word, matched anywhere in the name. */
const OFFENSIVE_PARTS = [
  'caralho',
  'buceta',
  'boceta',
  'arrombad',
  'filhodaputa',
  'estupr',
  'pedofil',
  'hitler',
];
/**
 * Offensive words that also hide inside innocent ones ("computador", "enviado"), so they only
 * block the whole name, optionally followed by digits.
 */
const OFFENSIVE_WORDS = [
  'puta',
  'viado',
  'bicha',
  'macaco',
  'merda',
  'porra',
  'corno',
  'fdp',
  'cuzao',
  'babaca',
  'otario',
  'piranha',
  'nazi',
  'vagabundo',
  'vagabunda',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

/** Removes the optional leading @ and surrounding spaces. */
export const cleanUsername = (input: string) => input.trim().replace(/^@/, '');

/** Lowercase, no dots or underscores, digits read as letters: how names are compared for abuse. */
function skeleton(username: string) {
  return username
    .toLowerCase()
    .replace(/[._]/g, '')
    .replace(/[013457]/g, (digit) => LEET[digit]);
}

/** Error message for an invalid username, or null when it can be used. */
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return 'Use pelo menos 3 caracteres.';
  if (username.length > 20) return 'Use no máximo 20 caracteres.';
  if (!/^[A-Za-z0-9_.]+$/.test(username))
    return 'Use só letras sem acento, números, ponto (.) e sublinhado (_).';
  if (/^[._]|[._]$/.test(username)) return 'Não comece nem termine com ponto ou sublinhado.';
  if (/[._]{2}/.test(username)) return 'Não use dois símbolos seguidos.';
  if (!/[A-Za-z]/.test(username)) return 'Use pelo menos uma letra.';
  const plain = username.toLowerCase().replace(/[._]/g, '');
  const read = skeleton(username);
  // "lula13" or "admin2026" impersonate just as well as the bare name.
  const word = plain.replace(/\d+$/, '');
  if (
    RESERVED.includes(plain) ||
    RESERVED.includes(word) ||
    RESERVED.includes(read) ||
    RESERVED_PARTS.some((part) => read.includes(part))
  )
    return 'Esse nome é reservado. Escolha outro.';
  if (
    OFFENSIVE_PARTS.some((part) => read.includes(part)) ||
    OFFENSIVE_WORDS.includes(word) ||
    OFFENSIVE_WORDS.includes(skeleton(word))
  )
    return 'Escolha um nome sem palavrões.';
  return null;
}
