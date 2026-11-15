// Chemins R2 admis (src/lib/storage-path.ts) : régression du dépôt des pièces d'adhérents (members/<saison>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStoragePath } from '../src/lib/storage-path.ts';

const club = '99d43b88-bb97-412e-80b8-2a1309682911';
const file = 'a6b1c2d3-1111-4222-8333-444455556666';

test('pièces d’adhérents : members/<saison> accepté', () => {
  assert.equal(isStoragePath(`${club}/members/2026-2027/${file}.png`), true);
  assert.equal(isStoragePath(`${club}/members/2026-2027/${file}.pdf`), true);
});

test('dossiers simples acceptés ; tout le reste refusé', () => {
  assert.equal(isStoragePath(`${club}/gallery/${file}.webp`), true);
  for (const bad of [
    `${club}/members/../${file}.png`,
    `${club}/members/2026/${file}.png`,
    `${club}/a/b/${file}.png`,
    `${club}/members/2026-2027/${file}.exe`,
    `../${club}/gallery/${file}.png`,
    `${club}/gallery/nom-choisi.png`,
  ]) {
    assert.equal(isStoragePath(bad), false, bad);
  }
});
