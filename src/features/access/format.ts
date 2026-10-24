export const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const two = (value: number) => String(Math.floor(value)).padStart(2, '0');

/** "0:45", "4:59" or, past an hour, "1:02:03". */
export const clock = (seconds: number) =>
  seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${two((seconds % 3600) / 60)}:${two(seconds % 60)}`
    : `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;
