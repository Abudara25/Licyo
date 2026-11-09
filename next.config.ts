import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=()',
  },
];

const nextConfig: NextConfig = {
  // Déployé sur Cloudflare Workers via OpenNext (voir wrangler.jsonc).
  poweredByHeader: false,
  images: {
    // Les images sont déjà compressées à l'envoi et servies depuis R2 (/media)
    // avec un cache long : pas de service d'optimisation à facturer.
    unoptimized: true,
  },
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

// `next dev` : donne accès aux liaisons Cloudflare locales (D1, R2) via getCloudflareContext.
initOpenNextCloudflareForDev();
