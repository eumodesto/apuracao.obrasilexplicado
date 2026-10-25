/**
 * Sticker packs sold in the shop. `credits` is how many sends the buyer gets — each send spends
 * one, and the same sticker may be sent again. Shared by the server and the shop screen.
 */
export const STICKER_PACKS = [
  { id: 's10', credits: 10, price: 3 },
  { id: 's20', credits: 20, price: 3.5 },
  { id: 's30', credits: 30, price: 4 },
  { id: 's50', credits: 50, price: 5 },
] as const;
export type StickerPack = (typeof STICKER_PACKS)[number];
