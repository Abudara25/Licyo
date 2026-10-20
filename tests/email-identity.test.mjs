// Identité du club dans les e-mails (2026-10-20) : les gabarits écrits pour le club de démo prennent, au point d'envoi,
// le nom, l'adresse, le lieu, les créneaux et les couleurs du club qui envoie. Le club de démo n'est pas modifié.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { sendFollowUpEmail, sendReminderEmail } from '../functions/_shared/confirmation-email.js';
import { clearEmailIdentityCache } from '../functions/_shared/email-identity.js';
import { createStarterSite } from '../functions/_shared/site-editor.js';
import { clearPublishedSiteCache } from '../functions/_shared/site-config.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { clearPageDataCache } from '../functions/_shared/page-data.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const ORG = 'org_natation_test';
const DEMO_TRACES = /Club Démo|Sportville|clubdemo|Stade municipal|#4f1414|#f0a030|crampons|jeudi de 17h/i;

async function setup(t, extra = {}) {
  clearEmailIdentityCache();
  clearPublishedSiteCache();
  clearOrganizationCache();
  clearPageDataCache();
  const env = { ...(await fixture()), BREVO_API_KEY: 'x', ...extra };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'natation-exemple', 'Les Dauphins Exemple')").bind(ORG).run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('dauphins.example', ?)").bind(ORG).run();
  await createStarterSite(env, {
    organizationId: ORG, slug: 'natation-exemple', domain: 'dauphins.example',
    profile: { name: 'Les Dauphins Exemple', sportLabel: 'Natation', city: 'Villeneuve-Exemple', email: 'bureau@dauphins.example', venueName: 'Piscine Exemple', venueAddress: '2 rue de l’Eau, 00000 Villeneuve-Exemple', colors: { primary: '#005f73', accent: '#ee9b00' } },
  });
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response('{"messageId":"x"}', { status: 201 });
  });
  return { env, sent };
}

test('e-mails d’un autre club : son nom, son adresse, son lieu et ses couleurs, aucune trace du démo', async (t) => {
  const { env, sent } = await setup(t, { MAIL_FROM: 'noreply@licyo.example' });
  const row = await seedInscription(env.DB, { organization_id: ORG, paye: 1, email: 'famille@exemple.example' });
  assert.equal(await sendFollowUpEmail(env, row, 'https://dauphins.example', { step: 'paiement', origin: 'manuel' }), true);
  assert.equal(await sendReminderEmail(env, { ...row, paye: 0 }, 'https://dauphins.example'), true);
  for (const mail of sent) {
    const all = `${mail.subject}\n${mail.htmlContent}\n${mail.textContent}\n${mail.sender.name}`;
    const m = all.match(DEMO_TRACES); assert.equal(m, null, m ? all.slice(Math.max(0, m.index - 120), m.index + 60) : '');
    assert.match(all, /Les Dauphins Exemple/);
    assert.equal(mail.sender.email, 'noreply@licyo.example');
    assert.deepEqual(mail.replyTo, { email: 'bureau@dauphins.example', name: 'Les Dauphins Exemple' });
  }
  const html = sent[0].htmlContent;
  assert.match(html, /Piscine Exemple/);
  assert.match(html, /assets\/images\/club\/email-logo\.png/);
  assert.match(html, /#[0-9a-f]{6}/);
});

test('club de démo : e-mails inchangés', async (t) => {
  const { env, sent } = await setup(t);
  const row = await seedInscription(env.DB, { organization_id: DEMO_ORG_ID, paye: 1 });
  await sendFollowUpEmail(env, row, 'https://clubdemo.licyo.fr', { step: 'paiement', origin: 'manuel' });
  assert.match(sent[0].htmlContent, /Club Démo/);
  assert.equal(sent[0].sender.email, 'contact@clubdemo.licyo.fr');
});
