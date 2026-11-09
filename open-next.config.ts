import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Sans cache incrémental configuré, unstable_cache ne conserve rien :
// les données sont toujours lues fraîches dans D1 (simple et correct en test).
// À activer plus tard (R2 + D1 tag cache) si la charge le justifie.
export default defineCloudflareConfig();
