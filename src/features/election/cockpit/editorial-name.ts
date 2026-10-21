/** Display casing only; official names and identities remain untouched. */
export function editorialName(name: string) {
  return name
    .toLocaleLowerCase('pt-BR')
    .replace(
      /(^|\s)(\p{L})/gu,
      (_, space: string, letter: string) => space + letter.toLocaleUpperCase('pt-BR'),
    )
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (part) => part.toLocaleLowerCase('pt-BR'));
}
