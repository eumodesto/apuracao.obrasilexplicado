export type Party = { code: string; number: string; name: string; color: string };

/** "Prefiro não informar": no political opinion is stored, so no consent is asked. */
export const NO_PARTY = 'none';

/**
 * Parties shown at sign-up. Based on the parties registered with the TSE before the 2026
 * election; check the current list at https://www.tse.jus.br/partidos before going live.
 * Colors only identify the party in the chat badge.
 */
export const PARTIES: Party[] = [
  { code: 'PT', number: '13', name: 'Partido dos Trabalhadores', color: '#c8102e' },
  { code: 'PL', number: '22', name: 'Partido Liberal', color: '#1f4e9c' },
  { code: 'MDB', number: '15', name: 'Movimento Democrático Brasileiro', color: '#2e9e44' },
  { code: 'PSD', number: '55', name: 'Partido Social Democrático', color: '#f2a900' },
  { code: 'UNIAO', number: '44', name: 'União Brasil', color: '#163d8c' },
  { code: 'PP', number: '11', name: 'Progressistas', color: '#2c6fbb' },
  { code: 'REPUBLICANOS', number: '10', name: 'Republicanos', color: '#2b7bb9' },
  { code: 'PSDB', number: '45', name: 'Partido da Social Democracia Brasileira', color: '#1d5fa6' },
  { code: 'PDT', number: '12', name: 'Partido Democrático Trabalhista', color: '#d7262e' },
  { code: 'PSB', number: '40', name: 'Partido Socialista Brasileiro', color: '#e35d1b' },
  { code: 'PSOL', number: '50', name: 'Partido Socialismo e Liberdade', color: '#ffcc00' },
  { code: 'PCDOB', number: '65', name: 'Partido Comunista do Brasil', color: '#b5121b' },
  { code: 'PODEMOS', number: '20', name: 'Podemos', color: '#21a0a0' },
  { code: 'NOVO', number: '30', name: 'Partido Novo', color: '#f47920' },
  { code: 'PV', number: '43', name: 'Partido Verde', color: '#3aa935' },
  { code: 'REDE', number: '18', name: 'Rede Sustentabilidade', color: '#0aa1a1' },
  { code: 'CIDADANIA', number: '23', name: 'Cidadania', color: '#e5007d' },
  { code: 'AVANTE', number: '70', name: 'Avante', color: '#f06a24' },
  { code: 'SOLIDARIEDADE', number: '77', name: 'Solidariedade', color: '#f58220' },
  { code: 'PRD', number: '25', name: 'Partido Renovação Democrática', color: '#0b4fa0' },
  {
    code: 'PRTB',
    number: '28',
    name: 'Partido Renovador Trabalhista Brasileiro',
    color: '#2b8a3e',
  },
  { code: 'DC', number: '27', name: 'Democracia Cristã', color: '#1565c0' },
  { code: 'AGIR', number: '36', name: 'Agir', color: '#7cb342' },
  { code: 'MOBILIZA', number: '33', name: 'Mobiliza', color: '#00897b' },
  { code: 'PMB', number: '35', name: 'Partido da Mulher Brasileira', color: '#8e24aa' },
  { code: 'PCB', number: '21', name: 'Partido Comunista Brasileiro', color: '#c62828' },
  {
    code: 'PSTU',
    number: '16',
    name: 'Partido Socialista dos Trabalhadores Unificado',
    color: '#d32f2f',
  },
  { code: 'PCO', number: '29', name: 'Partido da Causa Operária', color: '#b71c1c' },
  { code: 'UP', number: '80', name: 'Unidade Popular', color: '#e53935' },
  { code: 'SEM', number: '', name: 'Sem partido', color: '#87877e' },
];

export const partyByCode = (code: string | null | undefined) =>
  PARTIES.find((party) => party.code === code) ?? null;

export const validPartyChoice = (code: string) => code === NO_PARTY || !!partyByCode(code);
