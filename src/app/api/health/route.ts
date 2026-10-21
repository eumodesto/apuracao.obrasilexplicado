// Liveness check for the container and the load balancer: answers without touching the TSE or the database.
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
