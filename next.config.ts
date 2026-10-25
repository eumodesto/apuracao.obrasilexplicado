import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  // Development only: keep the Next.js badge away from the access badge and chat at the bottom.
  devIndicators: { position: 'top-left' },
  async headers() {
    // Maps/stickers are versioned by deploy; one day of browser cache cuts repeat load weight.
    const day = 'public, max-age=86400, stale-while-revalidate=604800';
    return [
      { source: '/stickers/:path*', headers: [{ key: 'Cache-Control', value: day }] },
      { source: '/maps/:path*', headers: [{ key: 'Cache-Control', value: day }] },
    ];
  },
};
export default config;
