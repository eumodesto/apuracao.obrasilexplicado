import { isGuest } from './access';
import { accessProduct, stickerProduct, type Product } from './products';
import type { AccessStatus, AccessUser } from './types';

/**
 * What this person may buy now, from the request body's `pack` (none = access), or why not.
 * Visitors create an account first; sticker packs need paid access.
 */
export function purchaseFor(
  user: AccessUser,
  status: AccessStatus,
  pack: unknown,
): { product: Product } | { error: string; status: number; code: string } {
  if (isGuest(user))
    return { error: 'Crie sua conta ou entre para pagar.', status: 403, code: 'signup' };
  if (pack === undefined || pack === null || pack === '') return { product: accessProduct() };
  const product = stickerProduct(pack);
  if (!product) return { error: 'Pacote indisponível.', status: 400, code: 'pack' };
  if (status.state !== 'paid')
    return {
      error: 'Figurinhas são para quem liberou o acesso. Libere o acesso primeiro.',
      status: 402,
      code: 'payment_required',
    };
  return { product };
}

/** Plain words for Mercado Pago's card refusals. */
export function cardMessage(detail: string | null | undefined) {
  switch (detail) {
    case 'cc_rejected_insufficient_amount':
      return 'Saldo ou limite insuficiente no cartão.';
    case 'cc_rejected_bad_filled_security_code':
      return 'Código de segurança (CVV) incorreto.';
    case 'cc_rejected_bad_filled_date':
      return 'Data de validade incorreta.';
    case 'cc_rejected_bad_filled_card_number':
    case 'cc_rejected_bad_filled_other':
      return 'Confira os dados do cartão.';
    case 'cc_rejected_call_for_authorize':
      return 'O banco pediu autorização: ligue para ele ou use outro cartão.';
    case 'cc_rejected_card_disabled':
      return 'Cartão desativado. Fale com o banco ou use outro cartão.';
    case 'cc_rejected_duplicated_payment':
      return 'Esse pagamento já foi feito.';
    case 'cc_rejected_high_risk':
      return 'Pagamento recusado por segurança. Tente o Pix.';
    case 'pending_contingency':
    case 'pending_review_manual':
      return 'Pagamento em análise. Avisamos aqui assim que for aprovado.';
    default:
      return 'Pagamento recusado. Confira os dados, use outro cartão ou pague com Pix.';
  }
}
