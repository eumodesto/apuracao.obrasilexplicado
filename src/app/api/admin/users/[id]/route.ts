import { forgetAccess } from '@/lib/access/guard';
import { accessStore } from '@/lib/access/store';
import { auditStore } from '@/lib/admin/audit';
import { withAdmin } from '@/lib/admin/guard';
import { adminUser } from '@/lib/admin/view';
import { deleteMessagesBy } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Pause (with a reason), reactivate or delete an account. */
export const POST = withAdmin<{ params: Promise<{ id: string }> }>(
  async (request, { params }, admin) => {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const action = body?.action;
    const store = accessStore();
    const user = await store.getUser(id);
    if (!user) return Response.json({ error: 'Conta não encontrada.' }, { status: 404 });
    if (user.id === admin.user.id)
      return Response.json({ error: 'Você não pode alterar a própria conta.' }, { status: 400 });
    const now = Date.now();
    let detail: string | null = null;
    if (action === 'pause') {
      const reason = String(body?.reason ?? '')
        .trim()
        .slice(0, 200);
      if (!reason) return Response.json({ error: 'Informe o motivo.' }, { status: 400 });
      await store.setPaused(id, { at: now, reason });
      detail = reason;
    } else if (action === 'unpause') {
      await store.setPaused(id, null);
    } else if (action === 'delete') {
      if (user.deletedAt) return Response.json({ error: 'Conta já excluída.' }, { status: 409 });
      const removed = await deleteMessagesBy(id, `admin:${admin.user.email}`);
      await store.anonymize(id, now);
      detail = `${removed} ${removed === 1 ? 'mensagem apagada' : 'mensagens apagadas'}`;
    } else return Response.json({ error: 'Ação inválida.' }, { status: 400 });
    // The account's next request sees the change, not a cached copy.
    forgetAccess(id);
    await auditStore().add({
      at: now,
      admin: admin.user.email,
      action: action === 'delete' ? 'delete_user' : action,
      target: user.username ? `@${user.username}` : id,
      detail,
    });
    return Response.json({ user: adminUser((await store.getUser(id))!) });
  },
);
