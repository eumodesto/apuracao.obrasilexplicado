import { priceBrl } from './config';
import { STICKER_PACKS } from './packs';
import type { PaymentPurpose } from './types';

export { STICKER_PACKS } from './packs';

export type Product = {
  purpose: PaymentPurpose;
  amount: number;
  /** Stickers added on approval (packs only). */
  credits: number | null;
  description: string;
};

export const accessProduct = (): Product => ({
  purpose: 'access',
  amount: priceBrl(),
  credits: null,
  description: 'Resultados Brasil — acesso à apuração até o resultado final',
});

/** The pack with this id, or null. Prices always come from here, never from the browser. */
export function stickerProduct(id: unknown): Product | null {
  const pack = STICKER_PACKS.find((p) => p.id === id);
  return pack
    ? {
        purpose: 'stickers',
        amount: pack.price,
        credits: pack.credits,
        description: `Resultados Brasil — ${pack.credits} figurinhas para o chat`,
      }
    : null;
}
