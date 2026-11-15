-- Rôles de club détaillés pour les gros clubs (2026-11-15) : vice-président, adjoints, dirigeant d'équipe, bénévole.
-- Source des droits : src/lib/permissions.ts. Cette migration ne fait qu'élargir la contrainte CHECK du rôle.
--
-- SQLite ne sait pas modifier un CHECK : la table est reconstruite à l'identique (mêmes colonnes, mêmes index),
-- toutes les lignes sont recopiées, aucune valeur n'est transformée. Aucune autre table ne référence staff_members.
-- À vérifier sur une copie de la base avant `npm run db:migrate:remote`.

PRAGMA defer_foreign_keys = true;

CREATE TABLE staff_members_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'super_admin',
    'president', 'vice_president',
    'secretary', 'assistant_secretary',
    'treasurer', 'assistant_treasurer',
    'coach', 'team_manager', 'volunteer'
  )),
  assigned_category_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_category_ids) AND json_type(assigned_category_ids) = 'array'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((role = 'super_admin') = (club_id IS NULL))
);

INSERT INTO staff_members_new (id, user_id, club_id, full_name, email, role, assigned_category_ids, created_at)
SELECT id, user_id, club_id, full_name, email, role, assigned_category_ids, created_at FROM staff_members;

DROP TABLE staff_members;
ALTER TABLE staff_members_new RENAME TO staff_members;

CREATE UNIQUE INDEX staff_members_user_club_uq ON staff_members(user_id, club_id);
CREATE UNIQUE INDEX staff_members_user_platform_uq ON staff_members(user_id) WHERE club_id IS NULL;
CREATE INDEX staff_members_club_idx ON staff_members(club_id);
