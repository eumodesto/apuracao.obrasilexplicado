import { request, type FullConfig } from '@playwright/test';
/** Signs in with the development test login so the panel and data APIs are reachable. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const context = await request.newContext({ baseURL });
  const response = await context.post('/api/auth/dev', { maxRedirects: 0 });
  if (response.status() !== 303)
    throw new Error(
      'Test login unavailable: run `npm run dev` without GOOGLE_CLIENT_ID (and with FREE_SECONDS=86400).',
    );
  await context.storageState({ path: 'test-results/.auth/session.json' });
  await context.dispose();
}
