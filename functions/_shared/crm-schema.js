// Schéma du CRM (phase 3, migrations 8 et 9) sous forme de liste d'OBJETS nommés (tables, index, triggers).
//
// Une même liste sert aux migrations (chaque objet appartient à la migration de sa version) ET au contrôle des
// invariants à chaque démarrage (repairCrmInvariants) : un index, un trigger ou une table critique manquant est
// recréé même si schema_migrations dit que la migration est appliquée (restauration partielle, suppression
// accidentelle). Tous les CREATE sont IF NOT EXISTS : recréer ne touche à aucune ligne.
//
// Sûreté : les index UNIQUE ne sont recréés que s'il n'existe aucun doublon (un doublon = échec explicite, jamais
// une suppression pour « faire passer » l'index). La migration 8 est conservée telle qu'appliquée en préproduction ;
// tout changement de modèle passe par une migration suivante (9).

const idx = (version, name, table, sql, dupSql = null) => ({ version, kind: 'index', name, table, sql, dupSql });

export const CRM_OBJECTS = [
  // ------------------------------------------------------------------ migration 8
  {
    version: 8, kind: 'table', name: 'contacts', table: 'contacts',
    sql: `CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        search_name TEXT NOT NULL,
        birth_date TEXT,
        email TEXT,
        phone TEXT,
        address_line1 TEXT,
        address_line2 TEXT,
        postal_code TEXT,
        city TEXT,
        country TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
        source TEXT NOT NULL DEFAULT 'manual',
        created_from_inscription_id INTEGER,
        created_from_role TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (organization_id, id)
      )`,
  },
  idx(8, 'idx_contacts_legacy_source', 'contacts',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_legacy_source ON contacts (organization_id, created_from_inscription_id, created_from_role) WHERE created_from_inscription_id IS NOT NULL',
    'SELECT COUNT(*) AS n /* toutes-organisations */ FROM (SELECT 1 FROM contacts WHERE created_from_inscription_id IS NOT NULL GROUP BY organization_id, created_from_inscription_id, created_from_role HAVING COUNT(*) > 1)'),
  idx(8, 'idx_contacts_org_name', 'contacts', 'CREATE INDEX IF NOT EXISTS idx_contacts_org_name ON contacts (organization_id, search_name)'),
  {
    version: 8, kind: 'table', name: 'periods', table: 'periods',
    sql: `CREATE TABLE IF NOT EXISTS periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('planned', 'open', 'closed')),
        is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (organization_id, slug),
        UNIQUE (organization_id, id),
        CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
      )`,
  },
  idx(8, 'idx_periods_one_current', 'periods',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_periods_one_current ON periods (organization_id) WHERE is_current = 1',
    'SELECT COUNT(*) AS n /* toutes-organisations */ FROM (SELECT 1 FROM periods WHERE is_current = 1 GROUP BY organization_id HAVING COUNT(*) > 1)'),
  {
    version: 8, kind: 'table', name: 'memberships', table: 'memberships',
    sql: `CREATE TABLE IF NOT EXISTS memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        contact_id INTEGER NOT NULL,
        period_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'ended', 'cancelled')),
        joined_at TEXT,
        ended_at TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        legacy_inscription_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id),
        FOREIGN KEY (organization_id, period_id) REFERENCES periods (organization_id, id),
        UNIQUE (organization_id, id)
      )`,
  },
  idx(8, 'idx_memberships_legacy', 'memberships',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_legacy ON memberships (organization_id, legacy_inscription_id) WHERE legacy_inscription_id IS NOT NULL',
    'SELECT COUNT(*) AS n /* toutes-organisations */ FROM (SELECT 1 FROM memberships WHERE legacy_inscription_id IS NOT NULL GROUP BY organization_id, legacy_inscription_id HAVING COUNT(*) > 1)'),
  idx(8, 'idx_memberships_org_contact', 'memberships', 'CREATE INDEX IF NOT EXISTS idx_memberships_org_contact ON memberships (organization_id, contact_id)'),
  idx(8, 'idx_memberships_org_period', 'memberships', 'CREATE INDEX IF NOT EXISTS idx_memberships_org_period ON memberships (organization_id, period_id, status)'),
  {
    version: 8, kind: 'table', name: 'contact_relationships', table: 'contact_relationships',
    sql: `CREATE TABLE IF NOT EXISTS contact_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        contact_id INTEGER NOT NULL,
        related_contact_id INTEGER NOT NULL,
        relationship_type TEXT NOT NULL CHECK (length(trim(relationship_type)) > 0),
        is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        legacy_inscription_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id, related_contact_id) REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
        CHECK (contact_id <> related_contact_id),
        UNIQUE (organization_id, contact_id, related_contact_id, relationship_type)
      )`,
  },
  idx(8, 'idx_relationships_org_contact', 'contact_relationships', 'CREATE INDEX IF NOT EXISTS idx_relationships_org_contact ON contact_relationships (organization_id, contact_id)'),
  idx(8, 'idx_relationships_org_related', 'contact_relationships', 'CREATE INDEX IF NOT EXISTS idx_relationships_org_related ON contact_relationships (organization_id, related_contact_id)'),
  {
    version: 8, kind: 'table', name: 'group_memberships', table: 'group_memberships',
    sql: `CREATE TABLE IF NOT EXISTS group_memberships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        membership_id INTEGER NOT NULL,
        group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
        group_label TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id, membership_id) REFERENCES memberships (organization_id, id) ON DELETE CASCADE
      )`,
  },
  idx(8, 'idx_group_memberships_org_membership', 'group_memberships', 'CREATE INDEX IF NOT EXISTS idx_group_memberships_org_membership ON group_memberships (organization_id, membership_id)'),
  idx(8, 'idx_group_memberships_org_group', 'group_memberships', 'CREATE INDEX IF NOT EXISTS idx_group_memberships_org_group ON group_memberships (organization_id, group_id)'),
  idx(8, 'idx_group_memberships_one_primary', 'group_memberships',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_group_memberships_one_primary ON group_memberships (organization_id, membership_id) WHERE is_primary = 1 AND ended_at IS NULL',
    'SELECT COUNT(*) AS n /* toutes-organisations */ FROM (SELECT 1 FROM group_memberships WHERE is_primary = 1 AND ended_at IS NULL GROUP BY organization_id, membership_id HAVING COUNT(*) > 1)'),
  {
    version: 8, kind: 'trigger', name: 'trg_group_memberships_same_org_ins', table: 'group_memberships',
    sql: `CREATE TRIGGER IF NOT EXISTS trg_group_memberships_same_org_ins BEFORE INSERT ON group_memberships
       WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.group_id AND organization_id = NEW.organization_id)
       BEGIN SELECT RAISE(ABORT, 'Groupe d''une autre organisation'); END`,
  },
  {
    version: 8, kind: 'trigger', name: 'trg_group_memberships_same_org_upd', table: 'group_memberships',
    sql: `CREATE TRIGGER IF NOT EXISTS trg_group_memberships_same_org_upd BEFORE UPDATE OF group_id, organization_id ON group_memberships
       WHEN NEW.group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups WHERE id = NEW.group_id AND organization_id = NEW.organization_id)
       BEGIN SELECT RAISE(ABORT, 'Groupe d''une autre organisation'); END`,
  },

  // ------------------------------------------------------------------ migration 9
  // Provenance des relations : une relation enfant ↔ responsable est PERMANENTE ; elle est soutenue par une ou
  // plusieurs inscriptions (une par saison, par exemple). Supprimer une inscription retire sa provenance ; la
  // relation ne disparaît que lorsque plus aucune inscription ne la soutient.
  idx(9, 'idx_relationships_org_id', 'contact_relationships', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_org_id ON contact_relationships (organization_id, id)'),
  {
    version: 9, kind: 'table', name: 'contact_relationship_sources', table: 'contact_relationship_sources',
    sql: `CREATE TABLE IF NOT EXISTS contact_relationship_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        relationship_id INTEGER NOT NULL,
        legacy_inscription_id INTEGER NOT NULL,
        source_role TEXT NOT NULL CHECK (source_role IN ('guardian1', 'guardian2')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id, relationship_id) REFERENCES contact_relationships (organization_id, id) ON DELETE CASCADE,
        UNIQUE (organization_id, relationship_id, legacy_inscription_id, source_role)
      )`,
  },
  idx(9, 'idx_relationship_sources_inscription', 'contact_relationship_sources',
    'CREATE INDEX IF NOT EXISTS idx_relationship_sources_inscription ON contact_relationship_sources (organization_id, legacy_inscription_id)'),
  {
    version: 9, kind: 'table', name: 'contact_duplicate_candidates', table: 'contact_duplicate_candidates',
    sql: `CREATE TABLE IF NOT EXISTS contact_duplicate_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        contact_id INTEGER NOT NULL,
        other_contact_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id, other_contact_id) REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
        CHECK (contact_id < other_contact_id),
        UNIQUE (organization_id, contact_id, other_contact_id)
      )`,
  },
  idx(9, 'idx_duplicate_candidates_other', 'contact_duplicate_candidates',
    'CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_other ON contact_duplicate_candidates (organization_id, other_contact_id)'),

  // ------------------------------------------------------------------ migration 10
  // Un emplacement (responsable 1 ou 2) d'une inscription soutient AU PLUS UNE relation. La création vérifie d'abord
  // qu'aucune donnée existante ne viole la règle (échec explicite sinon, rien n'est supprimé).
  idx(10, 'idx_relationship_sources_slot', 'contact_relationship_sources',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_relationship_sources_slot ON contact_relationship_sources (organization_id, legacy_inscription_id, source_role)',
    'SELECT COUNT(*) AS n /* toutes-organisations */ FROM (SELECT 1 FROM contact_relationship_sources GROUP BY organization_id, legacy_inscription_id, source_role HAVING COUNT(*) > 1)'),
];

// Une table CRM ABSENTE ne se recrée à vide que si aucune autre table ne contient de données qui en dépendent. Un index
// se reconstruit toujours ; une table porte de l'information (provenance, personnes, adhésions) qu'une table vide
// « saine » ferait disparaître en silence. contact_duplicate_candidates est dérivée et recalculable : jamais bloquante.
const NEEDED_BY = {
  contacts: ['memberships', 'contact_relationships'],
  periods: ['memberships'],
  memberships: ['group_memberships'],
  contact_relationships: ['contact_relationship_sources'],
  contact_relationship_sources: ['contact_relationships'],
};

export const CRM_TABLES = CRM_OBJECTS.filter((o) => o.kind === 'table').map((o) => o.name);

// Copie, dans la nouvelle table, la provenance déjà portée par relationships.legacy_inscription_id (préproduction,
// migration 8 appliquée avant la 9). Le rôle se déduit de is_primary (responsable 1 = principal).
const BACKFILL_SOURCES = `INSERT OR IGNORE INTO contact_relationship_sources (organization_id, relationship_id, legacy_inscription_id, source_role)
   SELECT organization_id, id, legacy_inscription_id, CASE WHEN is_primary = 1 THEN 'guardian1' ELSE 'guardian2' END
   FROM contact_relationships WHERE legacy_inscription_id IS NOT NULL`;

// Instructions de la migration `version`. Un index unique n'est posé que sans doublon existant.
export async function crmStatements(db, version) {
  const objects = CRM_OBJECTS.filter((o) => o.version === version);
  for (const object of objects) await assertNoDuplicates(db, object);
  const statements = objects.map((o) => db.prepare(o.sql));
  if (version === 9) statements.push(db.prepare(BACKFILL_SOURCES));
  return statements;
}

async function exists(db, name) {
  return Boolean(await db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').bind(name).first());
}

async function hasRows(db, table) {
  return (await exists(db, table)) && Boolean(await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first());
}

async function assertNoDuplicates(db, object) {
  if (!object.dupSql || !(await exists(db, object.table))) return;
  const { n } = await db.prepare(object.dupSql).first();
  if (n) throw new Error(`Schéma incohérent : ${object.table} contient des doublons empêchant de créer ${object.name} : corriger à la main, rien n'a été supprimé.`);
}

// Table absente alors que d'autres tables contiennent des données qui en dépendent : ÉCHEC EXPLICITE (fail closed).
// Aucune donnée n'est modifiée et aucune table vide n'est créée comme si tout était sain. Sans donnée personnelle.
export async function assertTableRecoverable(db, table) {
  const blockers = [];
  for (const dependent of NEEDED_BY[table] || []) if (await hasRows(db, dependent)) blockers.push(dependent);
  if (blockers.length) {
    throw new Error(
      `Schéma incohérent : la table ${table} est absente alors que ${blockers.join(', ')} contient des données qui en dépendent. ` +
        "Sa perte n'est pas réparable sans ambiguïté (provenance ou données historiques) : restaurer la table depuis une sauvegarde. Rien n'a été modifié."
    );
  }
}

// Garde-fou des opérations qui s'appuient sur la provenance (suppression RGPD) : refuse de continuer si la table de
// provenance manque alors que des relations existent, même si le schéma a déjà été validé plus tôt.
export async function assertProvenanceIntact(db) {
  if (!(await exists(db, 'contact_relationship_sources'))) await assertTableRecoverable(db, 'contact_relationship_sources');
}

// Instructions qui recréent, sans rien détruire, tout objet CRM manquant. Un index unique dont la table contient
// déjà des doublons n'est pas recréé : échec explicite (corriger à la main), rien n'est supprimé.
export async function repairCrmInvariants(db) {
  const statements = [];
  const repaired = [];
  for (const object of CRM_OBJECTS) {
    if (await exists(db, object.name)) continue;
    if (object.kind !== 'table' && !(await exists(db, object.table)) && !repaired.includes(object.table)) continue;
    if (object.kind === 'table') await assertTableRecoverable(db, object.name);
    await assertNoDuplicates(db, object);
    statements.push(db.prepare(object.sql));
    repaired.push(object.name);
  }
  return statements;
}
