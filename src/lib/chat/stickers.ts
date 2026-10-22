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
 * Every sticker people can send. Empty: stickers were taken out of the chat (21/10/2026). The
 * party-pack mechanism stays: add entries with partyPack(...) and their pictures to bring them back.
 */
export const STICKERS: Sticker[] = [];

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
  !sticker.party || sticker.party === party;

export const stickerById = (id: string | null | undefined) =>
  STICKERS.find((sticker) => sticker.id === id) ?? null;

/** Stickers this person can use (their party's packs); empty means none for now. */
export const stickersFor = (party: string | null | undefined) =>
  STICKERS.filter((sticker) => canUseSticker(sticker, party));
