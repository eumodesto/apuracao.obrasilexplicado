import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  // Development only: keep the Next.js badge away from the access badge and chat at the bottom.
  devIndicators: { position: 'top-left' },
};
export default config;
