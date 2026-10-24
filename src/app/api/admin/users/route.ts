import { adminCreateAccount } from '@/lib/access/credentials';
import { accessStore } from '@/lib/access/store';
import { auditStore } from '@/lib/admin/audit';
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

/** Creates an account with e-mail and password (team e-mails included, unlike the public sign-up). */
export const POST = withAdmin(async (request, _context, admin) => {
  const body = await request.json().catch(() => null);
  const result = await adminCreateAccount({ email: body?.email, password: body?.password });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  await auditStore().add({
    at: Date.now(),
    admin: admin.user.email,
    action: 'create_user',
    target: result.email,
    detail: null,
  });
  const user = await accessStore().getUser(result.id);
  return Response.json({ user: adminUser(user!) }, { status: 201 });
});
