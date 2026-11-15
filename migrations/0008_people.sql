-- Fiche adhérent suivie d'une saison à l'autre (2026-11-15), reprise du CRM de Saint-Gratien FC.
-- Une PERSONNE (people) par club ; chaque inscription de saison (members) y est rattachée (members.person_id).
-- Migration additive : rien n'est supprimé ni modifié dans les inscriptions existantes, hormis le rattachement.
--
-- Rapprochement CONSERVATEUR : même club, même prénom, même nom, même date de naissance exacte (casse et espaces
-- ignorés). Rien d'autre ne fusionne deux personnes : les ressemblances (même nom avec une autre date, etc.) sont
-- seulement signalées au bureau (src/lib/people.ts), jamais fusionnées automatiquement. Une réinscription par le lien
-- du club rattache explicitement à la personne de la saison précédente, même si l'orthographe a changé.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'X' CHECK (gender IN ('M','F','X')),
  match_key TEXT NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX people_club_name_idx ON people(club_id, last_name, first_name);
-- Pas d'unicité sur match_key : un rattachement explicite (réinscription) peut laisser deux fiches proches.
CREATE INDEX people_match_idx ON people(club_id, match_key);

ALTER TABLE members ADD COLUMN person_id TEXT REFERENCES people(id) ON DELETE SET NULL;
CREATE INDEX members_person_idx ON members(person_id);

-- Reprise de l'existant : une personne par (club, prénom, nom, date de naissance).
-- Identifiant généré PAR LIGNE (randomblob appelé dans l'expression : une sous-requête serait évaluée une seule fois).
INSERT INTO people (id, club_id, first_name, last_name, birth_date, gender, match_key, created_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  g.club_id, g.first_name, g.last_name, g.birth_date, g.gender, g.match_key, g.created_at
FROM (
  SELECT club_id, min(first_name) AS first_name, min(last_name) AS last_name, birth_date, min(gender) AS gender,
         lower(trim(first_name)) || '|' || lower(trim(last_name)) || '|' || birth_date AS match_key,
         min(created_at) AS created_at
  FROM members
  GROUP BY club_id, lower(trim(first_name)) || '|' || lower(trim(last_name)) || '|' || birth_date
) AS g;

UPDATE members SET person_id = (
  SELECT p.id FROM people p
  WHERE p.club_id = members.club_id
    AND p.match_key = lower(trim(members.first_name)) || '|' || lower(trim(members.last_name)) || '|' || members.birth_date
  ORDER BY p.created_at LIMIT 1
) WHERE person_id IS NULL;

-- Toute nouvelle inscription sans rattachement explicite : personne existante (même clé) ou nouvelle fiche.
CREATE TRIGGER members_link_person AFTER INSERT ON members WHEN NEW.person_id IS NULL
BEGIN
  INSERT INTO people (id, club_id, first_name, last_name, birth_date, gender, match_key)
  SELECT
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    NEW.club_id, NEW.first_name, NEW.last_name, NEW.birth_date, NEW.gender,
    lower(trim(NEW.first_name)) || '|' || lower(trim(NEW.last_name)) || '|' || NEW.birth_date
  WHERE NOT EXISTS (
    SELECT 1 FROM people
    WHERE club_id = NEW.club_id
      AND match_key = lower(trim(NEW.first_name)) || '|' || lower(trim(NEW.last_name)) || '|' || NEW.birth_date
  );
  UPDATE members SET person_id = (
    SELECT id FROM people
    WHERE club_id = NEW.club_id
      AND match_key = lower(trim(NEW.first_name)) || '|' || lower(trim(NEW.last_name)) || '|' || NEW.birth_date
    ORDER BY created_at LIMIT 1
  ) WHERE id = NEW.id;
END;
