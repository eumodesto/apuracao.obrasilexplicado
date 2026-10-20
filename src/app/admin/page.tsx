import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminSession } from '@/lib/admin/guard';
import { AdminApp } from './admin-app';
import './admin.css';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Administração — Resultados Brasil',
  robots: { index: false },
};

/** Internal area: accounts, chat moderation and the audit log. Invisible to everyone else. */
export default async function AdminPage() {
  const admin = await adminSession();
  if (!admin) notFound();
  return <AdminApp me={admin.user.email} />;
}
