import { request, type FullConfig } from '@playwright/test';
/**
 * Signs in with the development test login and completes the sign-up profile, so the panel and
 * data APIs are reachable.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const context = await request.newContext({ baseURL });
  const response = await context.post('/api/auth/dev', { maxRedirects: 0 });
  if (response.status() !== 303)
    throw new Error(
      'Test login unavailable: run `npm run dev` without GOOGLE_CLIENT_ID (and with FREE_SECONDS=86400).',
    );
  const profile = await context.post('/api/profile', {
    data: { username: 'teste_e2e', party: 'none' },
  });
  if (!profile.ok()) throw new Error(`Test sign-up failed: ${await profile.text()}`);
  await context.storageState({ path: 'test-results/.auth/session.json' });
  await context.dispose();
}
