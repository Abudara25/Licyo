// Vue d'ensemble (lot 3, 2026-11-13) : indicateurs de pilotage calculés depuis les fiches, sans liste d'actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview } from '../functions/admin/dashboard.js';

const DONE = { dossier_key: 'k', dossier_uploaded_at: 'x', dossier_status: 'valide', photo_uploaded_at: 'x', ville_naissance: 'V', pays_naissance: 'France', paye: 1 };

test('finances : attendu, encaissé, acomptes, Pass’Sport, exemptions, modes de paiement', () => {
  const rows = [
    { id: 1, ...DONE, mode_paiement: 'HelloAsso' },
    { id: 2, ...DONE, mode_paiement: 'Espèces', pass_sport_code: '26-AAAA-BBBB' },
    { id: 3, ...DONE, paye: 0, montant_recu_cents: 6000, montant_du_cents: 18000, mode_paiement: 'Chèque' },
    { id: 4, ...DONE, paye: 0, mode_paiement: 'Carte bancaire' },
    { id: 5, ...DONE, paiement_exempte: 'dirigeant' },
  ];
  const o = buildOverview(rows, { prix: 180 });
  assert.equal(o.finance.due, 18000 + 13000 + 18000 + 18000, 'exemption exclue, Pass’Sport déduit');
  assert.equal(o.finance.received, 18000 + 13000 + 6000);
  assert.equal(o.finance.rest, 67000 - 37000);
  assert.deepEqual(o.finance.partial, { count: 1, received: 6000 });
  assert.equal(o.finance.unpaidCount, 2);
  assert.equal(o.finance.byMode.HelloAsso, 18000);
  assert.equal(o.finance.byMode['Espèces'], 13000);
  assert.equal(o.finance.byMode['Chèque'], 6000);
  assert.deepEqual(o.finance.passSport, { count: 1, cents: 5000 });
  assert.deepEqual(o.finance.exempt, { count: 1, cents: 18000 });
});

test('effectifs, tenues par taille, licences, chèques par mois, rythme hebdomadaire', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const rows = [
    { id: 1, ...DONE, naissance: '2021-01-01', categorie: 'U6', taille_maillot: '4 ans', created_at: '2026-11-10 10:00:00' },
    { id: 2, ...DONE, naissance: '2021-02-01', categorie: 'U6', taille_maillot: '4 ans', tenue_commandee_at: 'x', licence_validee_at: 'x', created_at: '2026-11-02 10:00:00' },
    { id: 3, naissance: '2020-01-01', categorie: 'U7', paye: 0, created_at: '2026-11-11 10:00:00' },
  ];
  const o = buildOverview(rows, {
    prix: 180,
    cheques: [{ montant_cents: 9000, encaissement_prevu: '2026-12' }, { montant_cents: 9000, encaissement_prevu: '2026-12' }, { montant_cents: 6000, encaissement_prevu: '2026-11' }],
    preinscriptions: [{ naissance: '2017-01-01', groupe: 'U10' }, { naissance: '2017-02-01', groupe: 'U10', invited_at: 'x' }, { naissance: '2017-03-01', groupe: 'U10', inscription_id: 9 }],
    educateurs: [{ id: 1 }],
    now,
  });
  assert.equal(o.members, 2);
  assert.equal(o.pending, 1);
  assert.deepEqual(o.tenues.sizes['4 ans'], 1, 'seules les tenues à commander comptent par taille');
  assert.deepEqual([o.tenues.toOrder, o.tenues.ordered, o.tenues.given], [1, 1, 0]);
  assert.deepEqual(o.licence, { validee: 1, enCours: 0, aDemander: 1 });
  assert.deepEqual(o.cheques.map((c) => [c.month, c.count, c.cents]), [['2026-11', 1, 6000], ['2026-12', 2, 18000]]);
  assert.deepEqual(o.pre, { groups: 0, waiting: 1, invited: 1 });
  assert.equal(o.weeks.length, 10);
  assert.equal(o.weeks.at(-1).count, 2, 'semaine en cours : deux inscriptions');
  assert.equal(o.weeks.at(-2).count, 1);
  assert.equal(o.educateurs, 1);
});
