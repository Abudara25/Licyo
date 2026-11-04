import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validSections,
  resolveSections,
  DEFAULT_SECTIONS,
} from '../src/lib/site-composition.ts';
test('composition : ordre conservé, sections facultatives retirées', () => {
  assert.ok(validSections(['news', 'hero', 'practice']));
  assert.deepEqual(resolveSections(['news', 'hero']), ['news', 'hero']);
});
test('composition : accueil obligatoire, doublons et contenu arbitraire refusés', () => {
  for (const value of [
    [],
    ['news'],
    ['hero', 'hero'],
    ['hero', 'script'],
    null,
    {},
    ['hero', null],
  ])
    assert.equal(validSections(value), false);
  assert.deepEqual(resolveSections(undefined), DEFAULT_SECTIONS);
});
