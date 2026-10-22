export type Sticker = {
  id: string;
  /** Big symbol at the top (emoji cards). */
  emoji: string;
  /** Caption of emoji cards; the description read aloud for image stickers. */
  text: string;
  /** Card gradient. */
  from: string;
  to: string;
  /** Picture sticker (public/stickers/...) instead of the emoji card. */
  image?: string;
  /**
   * Party pack: only people who chose this party at sign-up see it in their tray and may send it.
   * Once sent, it shows in the chat for everyone, like any message.
   */
  party?: string;
  /** Pack open to several parties (e.g. ['PT', 'PL']); takes precedence over `party`. */
  parties?: string[];
  /** Title of the group in the tray. */
  pack?: string;
};

/**
 * Every sticker people can send. Today only the neutral "Apuração" pack (about the count itself, no
 * candidate, party or number), for people who chose the 13 or the 22. The party packs were taken
 * out (21/10/2026); partyPack(...) brings one back.
 */
export const STICKERS: Sticker[] = [
  ...sharedPack(['PT', 'PL'], 'apuracao', 'Apuração', [
    ['segura-coracao', 'Segura coração'],
    ['que-contagem', 'Que contagem!'],
    ['tensao-em-tempo-real', 'Tensão em tempo real'],
    ['clima-pegando-fogo', 'Clima pegando fogo'],
    ['disputa-acirrada', 'Disputa acirrada'],
    ['isso-ta-intenso', 'Isso tá intenso'],
    ['que-emocao', 'Que emoção!'],
    ['atualiza-ai', 'Atualiza aí!'],
    ['hoje-ninguem-dorme', 'Hoje ninguém dorme'],
  ]),
];

/** Picture stickers in public/stickers/<folder>/<name>.webp, open to several parties. */
export function sharedPack(
  parties: string[],
  folder: string,
  title: string,
  items: [name: string, text: string][],
): Sticker[] {
  return items.map(([name, text]) => ({
    id: `${folder}-${name}`,
    emoji: '',
    text,
    from: '#0b6b3a',
    to: '#074c2b',
    image: `/stickers/${folder}/${name}.webp`,
    parties,
    pack: title,
  }));
}

/** Picture stickers kept in public/stickers/<number>/<name>.webp. */
export function partyPack(
  party: string,
  number: string,
  from: string,
  to: string,
  items: [name: string, text: string][],
): Sticker[] {
  return items.map(([name, text]) => ({
    id: `${number}-${name}`,
    emoji: '',
    text,
    from,
    to,
    image: `/stickers/${number}/${name}.webp`,
    party,
  }));
}

/** Whether this person may see and send the sticker (party packs need the same party). */
export const canUseSticker = (sticker: Sticker, party: string | null | undefined) =>
  sticker.parties
    ? !!party && sticker.parties.includes(party)
    : !sticker.party || sticker.party === party;

export const stickerById = (id: string | null | undefined) =>
  STICKERS.find((sticker) => sticker.id === id) ?? null;

/** Stickers this person can use (their party's packs); empty means none for now. */
export const stickersFor = (party: string | null | undefined) =>
  STICKERS.filter((sticker) => canUseSticker(sticker, party));
