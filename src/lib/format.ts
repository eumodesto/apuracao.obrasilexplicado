export const number = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('pt-BR').format(value);
export const percent = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        value,
      );
export const time = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(value))
    : '—';
export const dateTime = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value))
    : '—';

/** "2º turno · 2026" from the snapshot's round; without data, just the year. */
export const roundLabel = (turn?: string | null) =>
  turn ? `${turn}º turno · 2026` : 'Eleições 2026';
