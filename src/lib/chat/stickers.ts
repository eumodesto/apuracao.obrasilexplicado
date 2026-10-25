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
 * Every sticker people can send. The neutral "Apuração" pack is open to everyone (visitors and free
 * accounts are offered access when they tap one). Party packs (partyPack) are only in the tray for
 * people who chose that party at sign-up.
 */
export const STICKERS: Sticker[] = [
  ...sharedPack(null, 'apuracao', 'Apuração', [
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
  ...partyPack('PT', '13', '#c8102e', '#8f0f1d', [
    ['faz-o-l', 'Faz o L'],
    ['bandeira-lula', 'Bandeira Lula'],
    ['lula-13-alckmin', 'Lula 13 Alckmin'],
    ['100-porcento-lula', '100% Lula'],
    ['sem-medo-de-ser-feliz', 'Sem medo de ser Feliz!'],
    ['botao-lula', 'Lula'],
    ['lula-13-presidente', 'Lula 13 Presidente'],
    ['lula-canarinho', 'Lula'],
    ['13-lula-presidente', '13 Lula Presidente'],
    ['dito-isso-lula-tetra', 'Dito isso, Lula tetra.'],
    ['o-meu-voto-e-secreto', 'O meu voto é secreto'],
    ['dia-25-vote-lula', 'Dia 25 vote Lula'],
    ['meu-voto-e-secreto-estrela', 'Meu voto é secreto!'],
  ]),
  ...partyPack('PL', '22', '#1f4e9c', '#0f2d5c', [
    ['nois-e-peao', 'Nois e peao'],
    ['camisa-22', 'Camisa 22'],
    ['peao-injaulado', 'Peao injaulado'],
    ['vamos-la', 'Vamos la'],
    ['hehehr', 'hehehr'],
    ['meu-presidente', 'Meu presidente'],
    ['kkkakkkksk', 'Kkkakkkksk'],
    ['o-brasil-e-nosso', 'o brasil e nosso'],
    ['kkk-forcado', 'Kkk forçado'],
    ['juntos-somos-mais', 'Juntos somos mais'],
    ['flavio-presidencial', 'Flávio 22'],
  ]),
];

/** Picture stickers in public/stickers/<folder>/<name>.webp, for these parties (null: everyone). */
export function sharedPack(
  parties: string[] | null,
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
    ...(parties ? { parties } : {}),
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
