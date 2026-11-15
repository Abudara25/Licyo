import type { NextConfig } from 'next';
import path from 'node:path';
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

// Mode gratuit (en attendant le premier client, puis offre Workers Paid à 5 $/mois) : LICYO_LITE=1 remplace les
// modules les plus lourds du serveur par des versions légères, pour tenir sous la limite de 3 Mo de l'offre
// gratuite de Cloudflare Workers. Rien n'est supprimé : sans LICYO_LITE, le build complet embarque tout.
// Voir docs/HEBERGEMENT_GRATUIT.md.
const lite = process.env.LICYO_LITE === '1';

const nextConfig: NextConfig = {
  // Déployé sur Cloudflare Workers via OpenNext (voir wrangler.jsonc).
  poweredByHeader: false,
  env: { NEXT_PUBLIC_LICYO_LITE: lite ? '1' : '0' },
  webpack(config, { isServer }) {
    if (lite && isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'next/og$': path.resolve(process.cwd(), 'src/lib/lite/og-stub.ts'),
      };
    }
    return config;
  },
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
