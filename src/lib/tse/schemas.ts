import { z } from 'zod';
const digits = z.string().regex(/^\d+$/);
export const integer = digits
  .transform(Number)
  .refine(Number.isSafeInteger)
  .refine((n) => n >= 0);
export const percentage = z
  .string()
  .regex(/^\d+(?:[,.]\d+)?$/)
  .transform((s) => Number(s.replace(',', '.')))
  .refine((n) => n >= 0 && n <= 100);
const optionalInteger = integer.nullish().transform((n) => n ?? null);
export const configSchema = z.object({
  f: z.literal('o'),
  arq: z.array(z.object({ tp: z.string(), dir: z.string() })),
  pl: z.array(
    z.object({
      cd: digits,
      c: z.string().regex(/^ele\d{4}$/),
      dt: z.string(),
      e: z.array(
        z.object({
          cd: digits,
          t: z.string(),
          abr: z.array(z.object({ cd: z.string(), cp: z.array(z.object({ cd: digits })) })),
        }),
      ),
    }),
  ),
});
export const geographySchema = z.object({
  f: z.literal('o'),
  abr: z.array(
    z.object({
      cd: z.string().regex(/^[a-z]{2}$/),
      ds: z.string().min(1),
      mu: z.array(z.object({ cd: z.string().regex(/^\d{5}$/), nm: z.string().min(1), cdi: z.string().optional(), z: z.array(z.string()).optional() })),
    }),
  ),
});
const candidate = z.object({
  n: digits,
  sqcand: digits,
  nm: z.string().min(1),
  nmu: z.string().min(1),
  seq: integer,
  e: z.enum(['s', 'n']),
  st: z.string(),
  vap: integer,
  pvap: percentage,
  dvt: z.string().optional(),
});
export const sectionsSchema = z
  .object({ ts: integer, st: integer, pst: percentage })
  .refine((s) => s.st <= s.ts, 'Counted sections exceed total');
export const resultSchema = z.object({
  ele: digits,
  t: z.literal('1'),
  f: z.literal('o'),
  tpabr: z.enum(['br', 'uf', 'mu']),
  cdabr: z.string(),
  dg: z.string(),
  hg: z.string(),
  idg: digits,
  dt: z.string(),
  ht: z.string(),
  dv: z.enum(['s', 'n']),
  tf: z.enum(['s', 'n']),
  and: z.enum(['n', 'p', 'f']),
  carg: z.array(
    z.object({
      cd: digits,
      fed: z.array(z.object({ n: digits, nm: z.string() })).optional(),
      agr: z.array(
        z.object({
          nm: z.string(),
          tp: z.enum(['c', 'i', 'f']),
          par: z.array(
            z.object({ sg: z.string(), nfed: z.string().optional(), cand: z.array(candidate) }),
          ),
        }),
      ),
    }),
  ),
  s: sectionsSchema,
  e: z.object({ te: optionalInteger, c: optionalInteger, a: optionalInteger }),
  v: z.object({ vv: optionalInteger, vb: optionalInteger, tvn: optionalInteger }),
});
export const trackingSchema = z.object({
  ele: digits,
  t: z.literal('1'),
  f: z.literal('o'),
  abr: z.array(
    z.object({
      cdabr: z.string(),
      tpabr: z.enum(['br', 'uf', 'mun']),
      and: z.enum(['n', 'p', 'f']),
      dt: z.string().optional(),
      ht: z.string().optional(),
      s: sectionsSchema,
    }),
  ),
});
export const querySchema = z
  .object({
    scope: z.enum(['br', 'exterior']).default('br'),
    state: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((s) => s.toLowerCase())
      .optional(),
    municipality: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
  })
  .strict()
  .refine(
    (q) => !q.municipality || q.state || q.scope === 'exterior',
    'Municipality requires state',
  )
  .refine((q) => q.scope !== 'exterior' || !q.state || q.state === 'zz', 'Exterior requires ZZ');
