import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_TIERS,
  tierForMembers,
  resolveTemplate,
  defaultModules,
  moduleEnabled,
} from '../src/lib/platform.ts';
test('tarification : chaque borne sélectionne une seule tranche, sans prix inventé', () => {
  for (const [count, id] of [
    [0, 'essentiel'],
    [100, 'essentiel'],
    [101, 'collectif'],
    [300, 'collectif'],
    [301, 'elan'],
    [700, 'elan'],
    [701, 'sur-mesure'],
  ] as const)
    assert.equal(tierForMembers(INITIAL_TIERS, count)?.id, id);
  assert.equal(tierForMembers(INITIAL_TIERS, -1), undefined);
  assert.equal(tierForMembers(INITIAL_TIERS, 1.2), undefined);
  assert.equal(
    tierForMembers(
      INITIAL_TIERS.map((t) => ({ ...t, is_active: false })),
      10,
    ),
    undefined,
  );
  assert.ok(
    INITIAL_TIERS.every(
      (t) => t.monthly_cents === null && t.stripe_price_id === null,
    ),
  );
});
test('modèles historiques compatibles, configuration par sport sans modèle imposé', () => {
  assert.equal(resolveTemplate('stadium'), 'arena');
  assert.equal(resolveTemplate('inconnu'), 'club');
  assert.equal(defaultModules('muaythai').private_lessons, true);
  assert.equal(defaultModules('football').private_lessons, false);
  assert.equal(moduleEnabled({ events: false }, 'events'), false);
  assert.equal(moduleEnabled({}, 'news'), true);
});

test('Muay thaï : vocabulaire de combat et sections sans héritage football', async () => {
  const { getSportPreset } = await import('../src/config/sports-presets.ts');
  const p = getSportPreset('muaythai');
  assert.equal(p.label, 'Muay thaï');
  assert.equal(p.vocabulary.groups, 'sections');
  assert.equal(p.vocabulary.hasScores, false);
  assert.equal(p.demo.categories[0].name, 'Enfants');
  const other = getSportPreset('Escalade');
  assert.equal(other.label, 'Escalade');
  assert.equal(other.vocabulary.groups, 'groupes');
});
