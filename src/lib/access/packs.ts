/** Sticker packs: each sticker sent spends one. Shared by the server and the shop screen. */
export const STICKER_PACKS = [
  { id: 's5', credits: 5, price: 2 },
  { id: 's20', credits: 20, price: 5 },
  { id: 's50', credits: 50, price: 10 },
] as const;
export type StickerPack = (typeof STICKER_PACKS)[number];
