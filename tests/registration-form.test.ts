// Formulaire d'inscription modulable : catalogue, réglages du club, validation serveur, stockage (migration 0003).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_CATALOG,
  catalogForSport,
  describeAnswers,
  parseFormConfig,
  resolveForm,
  validateExtraAnswers,
} from '../src/config/registration-fields.ts';
import { SPORTS_PRESETS, getSportPreset } from '../src/config/sports-presets.ts';
import { migratedDatabase } from './helpers/sqlite.ts';

test('périmètre : seulement des sports collectifs et de combat', () => {
  const families = new Set(Object.values(SPORTS_PRESETS).map((p) => p.family));
  assert.deepEqual([...families].sort(), ['collectif', 'combat']);
  for (const gone of ['tennis', 'natation', 'gymnastique', 'athletisme', 'badminton', 'danse']) {
    assert.equal(SPORTS_PRESETS[gone], undefined, gone);
  }
  for (const id of ['football', 'basketball', 'handball', 'volleyball', 'rugby']) assert.equal(SPORTS_PRESETS[id].family, 'collectif', id);
  for (const id of ['judo', 'boxe', 'muaythai', 'karate', 'taekwondo']) assert.equal(SPORTS_PRESETS[id].family, 'combat', id);
});

test('catalogue : clés uniques ; champs propres à une famille de sport', () => {
  const keys = FIELD_CATALOG.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  const foot = catalogForSport('football', 'collectif').map((f) => f.key);
  const muay = catalogForSport('muaythai', 'combat').map((f) => f.key);
  assert.ok(foot.includes('position') && foot.includes('strong_foot'));
  assert.ok(!foot.includes('grade') && !foot.includes('weight_kg'));
  assert.ok(muay.includes('grade') && muay.includes('weight_kg') && muay.includes('sport_passport'));
  assert.ok(!muay.includes('position'));
  assert.ok(!catalogForSport('basketball', 'collectif').some((f) => f.key === 'strong_foot'), 'pied fort : football et rugby');
  const position = resolveForm(parseFormConfig({ fields: { position: { mode: 'optional', audience: 'all' } } }), 'handball', 'collectif').find((f) => f.key === 'position');
  assert.ok(position?.options?.includes('Demi-centre'), 'postes propres au handball');
});

test('réglages : valeur absente → réglages par défaut ; entrées inconnues ou incomplètes écartées', () => {
  const empty = parseFormConfig(undefined);
  assert.deepEqual(empty, { fields: {}, custom: [] });
  const defaults = resolveForm(empty, 'muaythai', 'combat').map((f) => f.key);
  assert.ok(defaults.includes('license_number') && defaults.includes('grade') && defaults.includes('allergies'));
  const cfg = parseFormConfig({
    fields: { inconnu: { mode: 'required', audience: 'all' }, nationality: { mode: 'required', audience: 'tous' }, school: { mode: 'required', audience: 'minor' } },
    custom: [
      { id: 'c_taille', label: 'Taille de kimono ?', type: 'select', options: ['A1', 'A2', 'A2'], mode: 'optional', audience: 'all' },
      { id: 'c_vide', label: '   ', type: 'text', mode: 'optional', audience: 'all' },
      { id: 'pas_valide', label: 'Q', type: 'text', mode: 'optional', audience: 'all' },
      { id: 'c_liste', label: 'Une seule option', type: 'select', options: ['A'], mode: 'optional', audience: 'all' },
      { id: 'c_taille', label: 'Doublon', type: 'text', mode: 'optional', audience: 'all' },
    ],
  });
  assert.deepEqual(Object.keys(cfg.fields), ['school']);
  assert.deepEqual(cfg.custom.map((q) => q.id), ['c_taille']);
  assert.deepEqual(cfg.custom[0].options, ['A1', 'A2']);
});

test('validation : obligatoire selon le public, listes fermées, nombres bornés, champs inconnus ignorés', () => {
  const cfg = parseFormConfig({
    fields: {
      school: { mode: 'required', audience: 'minor' },
      profession: { mode: 'required', audience: 'adult' },
      weight_kg: { mode: 'optional', audience: 'all' },
      parental_authorization: { mode: 'required', audience: 'minor' },
      license_number: { mode: 'off', audience: 'all' },
    },
    custom: [{ id: 'c_niveau', label: 'Ceinture visée', type: 'select', options: ['Jaune', 'Orange'], mode: 'required', audience: 'all' }],
  });
  const fields = resolveForm(cfg, 'judo', 'combat');
  const minor = validateExtraAnswers(fields, { school: 'Collège Jean Moulin', parental_authorization: true, c_niveau: 'Jaune', weight_kg: '42,5', license_number: 'X', pirate: 'x' }, true, 'Léa');
  // Champ désactivé (license_number) et clé inconnue (pirate) écartés ; virgule décimale acceptée.
  assert.deepEqual(minor, {
    ok: true,
    value: { school: 'Collège Jean Moulin', weight_kg: 42.5, parental_authorization: true, c_niveau: 'Jaune' },
  });
  const noAuth = validateExtraAnswers(fields, { school: 'X', c_niveau: 'Jaune' }, true, 'Léa');
  assert.equal(noAuth.ok, false);
  assert.match(!noAuth.ok ? noAuth.error : '', /Léa : « J’autorise mon enfant/);
  // Un adulte : l'école ne le concerne pas, la profession oui.
  assert.equal(validateExtraAnswers(fields, { c_niveau: 'Orange' }, false, 'Marc').ok, false);
  assert.equal(validateExtraAnswers(fields, { c_niveau: 'Orange', profession: 'Infirmier' }, false, 'Marc').ok, true);
  assert.equal(validateExtraAnswers(fields, { c_niveau: 'Rouge', profession: 'X' }, false, 'Marc').ok, false, 'choix hors liste');
  assert.equal(validateExtraAnswers(fields, { c_niveau: 'Jaune', profession: 'X', weight_kg: '900' }, false, 'Marc').ok, false, 'poids hors bornes');
});

test('affichage au bureau : libellés du catalogue et des questions, champ retiré signalé', () => {
  const cfg = parseFormConfig({ custom: [{ id: 'c_q', label: 'Covoiturage possible ?', type: 'checkbox', mode: 'optional', audience: 'all' }] });
  assert.deepEqual(describeAnswers(cfg, { grade: 'Ceinture verte', c_q: true, c_old: 'x', vide: '' }), [
    { label: 'Grade ou ceinture actuel', value: 'Ceinture verte' },
    { label: 'Covoiturage possible ?', value: 'Oui' },
    { label: 'Question retirée par le club', value: 'x' },
  ]);
});

test('migration 0003 : colonnes JSON contrôlées, vue publique avec les réglages', () => {
  const raw = migratedDatabase();
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES ('c1', 'Club', 'club', 'Paris', '75001', 'a@test.fr', 'active')`).run();
  const row = raw.prepare('SELECT registration_form FROM public_clubs WHERE id = ?').get('c1') as { registration_form: string };
  assert.equal(row.registration_form, '{}');
  assert.throws(() => raw.prepare(`UPDATE clubs SET registration_form = '[]' WHERE id = 'c1'`).run());
  assert.throws(() => raw.prepare(`UPDATE clubs SET registration_form = 'pas du json' WHERE id = 'c1'`).run());
  assert.equal(getSportPreset('inconnu').family, 'collectif', 'preset générique');
});
