import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { MunicipalMetric } from './municipal-map';
const metric = z.object({
  code: z.string().regex(/^\d{5}$/),
  name: z.string(),
  uf: z.string().regex(/^[a-z]{2}$/),
  version: z.string(),
  updatedAt: z.string().datetime({ offset: true }),
  counted: z.number().min(0).max(100),
  validVotes: z.number().nonnegative().nullable(),
  stale: z.boolean(),
  candidates: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      name: z.string(),
      votes: z.number().nonnegative(),
      percentage: z.number().min(0).max(100),
      color: z.string(),
    }),
  ),
});
const envelope = z.object({
  source: z.literal('https://resultados.tse.jus.br'),
  election: z.literal('6257'),
  generatedAt: z.string().datetime(),
  results: z.array(metric),
});
let loading: Promise<z.infer<typeof envelope> | null> | undefined;
/**
 * Published last-known official results; live resources remain authoritative.
 * The file belongs to one election (the 1st round), so other elections get nothing from it.
 */
export async function municipalBaseline(election: string): Promise<MunicipalMetric[]> {
  const data = await (loading ??= readFile(
    path.join(process.cwd(), 'data/tse/municipal-baseline.json'),
    'utf8',
  )
    .then((text) => envelope.parse(JSON.parse(text)))
    .catch(() => {
      loading = undefined;
      return null;
    }));
  return data?.election === election ? data.results : [];
}
