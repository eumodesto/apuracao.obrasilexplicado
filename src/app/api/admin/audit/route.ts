import { auditStore } from '@/lib/admin/audit';
import { withAdmin } from '@/lib/admin/guard';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withAdmin(async () =>
  Response.json(
    { entries: await auditStore().list(200) },
    { headers: { 'Cache-Control': 'no-store' } },
  ),
);
