import { auditStore } from '@/lib/admin/audit';
import { withAdmin } from '@/lib/admin/guard';
import { chat, deleteMessage } from '@/lib/chat/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Deletes a chat message for everyone, live. */
export const DELETE = withAdmin<{ params: Promise<{ id: string }> }>(
  async (_request, { params }, admin) => {
    const { id } = await params;
    if (!/^[a-z0-9]{8,40}$/.test(id))
      return Response.json({ error: 'Mensagem inválida.' }, { status: 400 });
    const message = await chat().store.get(id);
    if (!message) return Response.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
    const removed = await deleteMessage(id, `admin:${admin.user.email}`);
    if (removed)
      await auditStore().add({
        at: Date.now(),
        admin: admin.user.email,
        action: 'delete_message',
        target: `@${message.username}`,
        detail: message.text.slice(0, 120),
      });
    return Response.json({ ok: true, removed });
  },
);
