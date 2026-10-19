// Comptes de test (phase 3) : un compte nominatif avec une appartenance active au club, pour ouvrir une session admin
// dans les tests. Une adresse par club et par rôle : appeler deux fois renvoie le même compte.
import { ensureSchema } from '../../functions/_shared/inscriptions-db.js';
import { hashPassword } from '../../functions/_shared/security.js';

const HASH = hashPassword('mot-de-passe-de-test-123');
export const TEST_PASSWORD = 'mot-de-passe-de-test-123';

export async function testUser(env, organizationId, role = 'owner', { email = null, name = 'Compte Test' } = {}) {
  await ensureSchema(env.DB);
  const address = (email || `${role}.${organizationId}@test.example`).toLowerCase();
  const id = `usr_test_${role}_${organizationId}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60) + (email ? `_${address.replace(/[^a-z0-9]/g, '')}`.slice(0, 20) : '');
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').bind(id, address, name, await HASH).run();
  await env.DB.prepare("INSERT OR REPLACE INTO organization_memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'active')").bind(organizationId, id, role).run();
  return id;
}
