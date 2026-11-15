// Registre des traitements (src/lib/processing-register.ts) et autorisation demandée après l'inscription.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegister, type RegisterInput } from '../src/lib/processing-register.ts';
import { parseRetentionPolicy } from '../src/lib/retention.ts';
import { DEFAULT_AUTHORIZATION_TEXT, authorizationPending, buildSignedAuthorization, parseSignedAuthorization } from '../src/config/parental-authorization.ts';

const base: RegisterInput = {
  club: {
    name: 'Judo Club Test',
    city: 'Poissy',
    postalCode: '78300',
    contactEmail: 'contact@club.test',
    presidentName: 'Claire Martin',
    rnaNumber: 'W781234567',
    siretNumber: null,
    sportLabel: 'Judo',
    modules: { payments: true, trials: false, attendance: true },
    emailProvider: 'platform',
    stripeConnected: false,
  },
  formFields: ['Numéro de licence', 'Grade (ceinture)'],
  documents: ['Photo d’identité'],
  medicalCertificate: true,
  parentalAuthorization: true,
  retention: parseRetentionPolicy({ enabled: true, documentsMonths: 6, membersYears: 2 }),
  access: { members: { 'Président(e)': 1, 'Secrétaire': 2 }, finance: { 'Trésorier(e)': 1 }, communication: {}, coaches: 3 },
  helloAsso: true,
  newsletter: true,
};

test('registre : responsable, activités selon les modules, durées et accès réels', () => {
  const r = buildRegister(base);
  assert.equal(r.controller.representative, 'Claire Martin, président(e)');
  assert.equal(r.controller.identifiers, 'RNA W781234567');
  const titles = r.activities.map((a) => a.title);
  assert.ok(titles.includes('Cotisations et trésorerie') && titles.includes('Présences, convocations et rencontres') && titles.includes('Autorisation parentale'));
  assert.ok(!titles.includes('Séances d’essai'), 'module désactivé : pas d’activité');
  const members = r.activities[0];
  assert.match(members.data.join(' | '), /Numéro de licence, Grade \(ceinture\)/);
  assert.match(members.retention, /2 ans après la fin de la saison/);
  assert.equal(members.sensitive, undefined, 'aucun champ de santé demandé');
  const withHealth = buildRegister({ ...base, formFields: ['Allergies ou traitement en cours', 'Taille de maillot'] }).activities[0];
  assert.match(withHealth.sensitive ?? '', /art\. 9\) : Allergies ou traitement en cours\./);
  assert.equal(buildRegister({ ...base, formFields: ['Moyen de paiement préféré', 'PAI (projet d’accueil individualisé)'] }).activities[0].sensitive?.includes('paiement'), false);
  assert.match(members.recipients.join(' '), /Président\(e\) \(1\), Secrétaire \(2\)/);
  assert.match(members.recipients.join(' '), /Éducateurs \(3\)/);
  const health = r.activities.find((a) => a.title === 'Pièces justificatives et santé');
  assert.match(health?.sensitive ?? '', /art\. 9/);
  assert.match(health?.retention ?? '', /6 mois/);
  assert.ok(r.processors.some((p) => p.name === 'HelloAsso'));
  assert.ok(!r.processors.some((p) => p.name === 'Stripe'), 'paiement en ligne non connecté');
  assert.match(r.activities.find((a) => a.title === 'Communication avec les familles')!.recipients[0], /personne pour l’instant/);
});

test('registre : conservation non activée signalée, identifiants à compléter', () => {
  const r = buildRegister({ ...base, club: { ...base.club, rnaNumber: null, presidentName: null }, retention: parseRetentionPolicy({}) });
  assert.equal(r.controller.identifiers, 'RNA ou SIRET à compléter');
  assert.match(r.activities[0].retention, /n’est pas activée/);
  assert.ok(!r.security.some((s) => s.includes('chaque nuit')));
});

test('autorisation après l’inscription : demandée aux seuls mineurs de la saison, signature du lien gardée', async () => {
  const m = { is_minor: true, anonymized_at: null, parental_authorization: null, season: '2026-2027', dossier_status: 'trial_requested' };
  assert.equal(authorizationPending(m, '2026-2027'), true);
  assert.equal(authorizationPending({ ...m, is_minor: false }, '2026-2027'), false);
  assert.equal(authorizationPending({ ...m, season: '2025-2026' }, '2026-2027'), false);
  assert.equal(authorizationPending({ ...m, dossier_status: 'rejected' }, '2026-2027'), false);
  assert.equal(authorizationPending({ ...m, parental_authorization: { text: 'x' } }, '2026-2027'), false);
  assert.equal(authorizationPending(null, '2026-2027'), false);
  const signed = await buildSignedAuthorization(
    DEFAULT_AUTHORIZATION_TEXT,
    { signerName: ' Paul Martin ', signerQuality: 'pere', childName: 'Léo MARTIN', birthDate: '2015-04-12', clubName: 'JCT', sport: 'Judo', season: '2026-2027' },
    { now: new Date('2026-11-15T10:00:00Z'), channel: 'lien', signatureDataUrl: 'data:image/png;base64,AAA' },
  );
  assert.equal(signed.signerName, 'Paul Martin');
  assert.match(signed.text, /en qualité de père de Léo MARTIN/);
  const back = parseSignedAuthorization(JSON.stringify(signed));
  assert.deepEqual([back?.channel, back?.signatureDataUrl], ['lien', 'data:image/png;base64,AAA']);
  assert.equal(parseSignedAuthorization({ ...signed, signatureDataUrl: 'javascript:alert(1)' })?.signatureDataUrl, undefined, 'seule une image PNG est gardée');
  assert.equal(parseSignedAuthorization({ ...signed, channel: undefined })?.channel, 'inscription');
});
