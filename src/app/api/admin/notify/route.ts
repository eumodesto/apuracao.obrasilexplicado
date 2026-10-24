import { withAdmin } from '@/lib/admin/guard';
import { notifyStore } from '@/lib/notify/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** "Me avise" list as CSV, for the e-mail service. */
export const GET = withAdmin(async () => {
  const signups = await notifyStore().list();
  const csv = [
    'email,cadastrado_em',
    ...signups.map((s) => `${s.email},${new Date(s.createdAt).toISOString()}`),
  ].join('\n');
  return new Response(csv + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="avisos-2-turno.csv"',
      'Cache-Control': 'no-store',
    },
  });
});
