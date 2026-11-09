// Lien de connexion à usage unique sans envoi d'e-mail (phase de test, avant le
// domaine d'envoi). Réservé au propriétaire : il faut l'accès wrangler au compte.
//
// Usage : npm run login-link -- admin@licyo.test                 (base locale, http://localhost:8787)
//         npm run login-link -- admin@licyo.test --remote        (base hébergée)
//         npm run login-link -- admin@licyo.test --base http://localhost:3000
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const email = args.find((a) => a.includes('@'))?.trim().toLowerCase();
if (!email || !/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) throw new Error('Adresse e-mail attendue.');
const remote = args.includes('--remote');
const baseIndex = args.indexOf('--base');
const config = readFileSync('wrangler.jsonc', 'utf8');
const remoteBase = /"NEXT_PUBLIC_APP_URL":\s*"([^"]+)"/.exec(config)?.[1];
const base = baseIndex >= 0 ? args[baseIndex + 1] : remote ? remoteBase : 'http://localhost:8787';
if (!base) throw new Error('URL de base introuvable.');

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('hex');
const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
// Le compte doit exister (comptes créés par le seed, une invitation ou /commencer).
const sql = `INSERT INTO auth_login_tokens (token_hash, email, create_user, expires_at) SELECT '${hash}', email, 0, '${expires}' FROM auth_users WHERE email = '${email}';`;
const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'licyo', remote ? '--remote' : '--local', '--command', `"${sql}"`, '--json'], { shell: true, encoding: 'utf8' });
const changes = /"changes":\s*(\d+)/.exec(out)?.[1];
if (changes === '0') throw new Error(`Aucun compte pour ${email}.`);
console.log(`Lien valable 15 minutes, une seule fois :\n${base}/auth/callback?token=${token}&next=%2Fclub-admin`);
