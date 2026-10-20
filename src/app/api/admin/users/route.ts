import { accessStore } from '@/lib/access/store';
import { withAdmin } from '@/lib/admin/guard';
import { adminUser } from '@/lib/admin/view';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PAGE = 25;
/** Search by username, e-mail, name or account id. */
export const GET = withAdmin(async (request) => {
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = (params.get('q') ?? '').slice(0, 100);
  const { users, total } = await accessStore().listUsers({
    query,
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  return Response.json(
    { users: users.map((user) => adminUser(user)), total, page, pageSize: PAGE },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
