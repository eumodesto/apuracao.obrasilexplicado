export type Party = {
  code: string;
  number: string;
  name: string;
  color: string;
  /** Side of the political spectrum shown on the sign-up card. */
  side: 'esquerda' | 'direita';
};

/** "Prefiro não informar": no political opinion is stored, so no consent is asked. */
export const NO_PARTY = 'none';

/**
 * Choices at sign-up: the two parties in the presidential 2nd round of 2026.
 * Colors only identify the side in the chat badge.
 */
export const PARTIES: Party[] = [
  {
    code: 'PT',
    number: '13',
    name: 'Partido dos Trabalhadores',
    color: '#c8102e',
    side: 'esquerda',
  },
  { code: 'PL', number: '22', name: 'Partido Liberal', color: '#1f4e9c', side: 'direita' },
];

export const partyByCode = (code: string | null | undefined) =>
  PARTIES.find((party) => party.code === code) ?? null;

export const validPartyChoice = (code: string) => code === NO_PARTY || !!partyByCode(code);
