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
};

/**
 * Every sticker people can send. Today only the PT (13) pack: the emoji examples were removed, so
 * people of other parties (or none) have no stickers yet.
 */
export const STICKERS: Sticker[] = [
  ...partyPack('PT', '13', '#e0313f', '#8f0f1d', [
    ['o-pai-ta-on', 'O pai tá on'],
    ['100-lula', '100% Lula'],
    ['calma-conta-ate-13', 'Tá nervoso? Calma, respira e conta até 13'],
    ['toma-aqui-tua-anistia', 'Toma aqui tua anistia'],
    ['coracao', 'Coração com as mãos'],
    ['abraco-na-estrela', 'Abraço na estrela'],
    ['lingua', 'Língua de fora'],
  ]),
];

/** Picture stickers kept in public/stickers/<number>/<name>.webp. */
function partyPack(
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
  !sticker.party || sticker.party === party;

export const stickerById = (id: string | null | undefined) =>
  STICKERS.find((sticker) => sticker.id === id) ?? null;

/** Stickers this person can use (their party's packs); empty means none for now. */
export const stickersFor = (party: string | null | undefined) =>
  STICKERS.filter((sticker) => canUseSticker(sticker, party));
