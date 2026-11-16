// Boutons Appel / Message (WhatsApp) / SMS des responsables (2026-11-04) : numéro converti au format international, WhatsApp
// Appel et Message visibles partout, SMS sur appareil tactile seulement, rien d'injectable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { internationalPhone, phoneLinks, contactActions, familyActions } from '../functions/_shared/admin-auth.js';

test('numéros : français (06, +33, 0033, avec (0)) et internationaux, sinon rien', () => {
  for (const p of ['06 12 34 56 78', '06.12.34.56.78', '+33 6 12 34 56 78', '+33 (0)6 12 34 56 78', '0033 6 12 34 56 78']) assert.equal(internationalPhone(p), '33612345678', p);
  assert.equal(internationalPhone('+32 470 12 34 56'), '32470123456');
  assert.equal(internationalPhone('12 34'), null);
  assert.equal(internationalPhone('00 12 34 56 78'), null);
  assert.equal(internationalPhone(''), null);
});

test('liens : Appel et Message séparés sur tous les appareils, SMS sur appareil tactile', () => {
  const html = phoneLinks('06 12 34 56 78', '', { sms: true }).join('');
  assert.match(html, /href="https:\/\/wa\.me\/33612345678" target="_blank" rel="noopener">.*Message</);
  assert.match(html, /class="adm-btn adm-btn-ghost" href="tel:\+33612345678">.*Appel</);
  assert.doesNotMatch(html, /WhatsApp/, 'ni logo ni nom de marque');
  assert.match(html, /adm-touch-only" href="sms:\+33612345678"/);
  assert.doesNotMatch(phoneLinks('06 12 34 56 78').join(''), /sms:/, 'pas de SMS sur les cartes');
  assert.doesNotMatch(phoneLinks('12 34').join(''), /wa\.me/, 'numéro non reconnu : pas de WhatsApp');
  assert.deepEqual(phoneLinks(''), []);
  assert.doesNotMatch(phoneLinks('06"><script>').join(''), /<script>/);
});

test('fiches et cartes : WhatsApp proposé, bloc visible sur ordinateur même sans e-mail', () => {
  const fiche = contactActions({ phone: '0612345678', email: '', name: 'Karim' });
  assert.match(fiche, /wa\.me\/33612345678/);
  assert.doesNotMatch(fiche, /adm-contact-actions adm-touch-only/);
  assert.doesNotMatch(contactActions({ phone: "12", email: "" }), /adm-touch-only"><a/, "Appel seul : visible partout");
  const carte = familyActions({ phone: '0612345678', inscriptionId: 3, child: 'Léa' });
  assert.match(carte, /wa\.me\/33612345678/);
  assert.match(carte, /\/admin\/email\?inscription=3/);
});
