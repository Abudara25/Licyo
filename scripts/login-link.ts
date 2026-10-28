// Affiche un lien de connexion pour un compte de test, sur un Supabase LOCAL uniquement.
// Usage : node --experimental-strip-types scripts/login-link.ts president@hbc.test [/club-admin]
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('Supabase local uniquement.');
const [email, next = '/club-admin'] = process.argv.slice(2);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
if (error) throw error;
const { hashed_token } = data.properties;
console.log(`${env.NEXT_PUBLIC_APP_URL}/auth/callback?token_hash=${hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`);
