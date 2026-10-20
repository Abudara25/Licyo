// Migrations versionnées de la base D1 (fondations SaaS, 2026-09-23).
//
// Le site n'a pas d'étape de build : comme avant, le schéma se met à jour tout seul au premier accès,
// une fois par instance du Worker. Chaque migration numérotée s'applique dans UNE transaction D1
// (db.batch) qui l'inscrit aussi dans schema_migrations : elle est appliquée entièrement ou pas du tout.
//
// Règles pour écrire une migration :
// - additive (CREATE ... IF NOT EXISTS, ADD COLUMN, CREATE INDEX IF NOT EXISTS, INSERT OR IGNORE, UPDATE ciblé) ;
//   seule exception, la reconstruction d'une table dont SQLite ne sait pas changer la clé (copie puis
//   remplacement dans la même transaction, documentée dans la migration, ex. migration 5) ;
// - rejouable : si deux Workers la lancent en même temps, le second échoue sur la clé de schema_migrations,
//   relit les versions appliquées et continue ;
// - ne jamais modifier une migration déjà en production : en ajouter une nouvelle.
//
// La table historique `inscriptions` garde sa propre mise à niveau (inscriptions-db.js), exécutée juste
// avant celles-ci : les migrations numérotées peuvent donc supposer qu'elle existe.

import { crmStatements, repairCrmInvariants } from './crm-schema.js';
import { NEWS_MIGRATION_VERSION, checkNewsSchema, newsMigrationStatements } from './news-schema.js';
import { normalizeSql, SchemaIntegrityError } from './schema-utils.js';
import { ACCOUNTS_MIGRATION_VERSION, accountsMigrationStatements, repairAccountsInvariants, GROUP_SCOPE_MIGRATION_VERSION, groupScopeMigrationStatements, repairGroupScopeInvariants } from './accounts.js';

// Première organisation réelle de la plateforme. Identifiant opaque et stable (le slug, lui, peut changer).
export const DEMO_ORG_ID = 'org_demo';
// Domaines de Sportville enregistrés par la migration 1 (valeurs figées de cette migration). Servent UNIQUEMENT à
// reconnaître Sportville quand la base est indisponible, pour son secours statique (functions/_shared/public-site.js) ;
// l'organisation d'une requête se résout toujours en base (organization.js).
export const DEMO_DOMAINS = Object.freeze(['clubdemo.licyo.fr', 'www.clubdemo.licyo.fr', 'licyo.pages.dev']);

// Tables rattachées à une organisation pendant la phase 1 (voir tests/tenant-scoping.test.mjs, qui vérifie
// que toute requête sur ces tables filtre par organization_id). site_events (R0a) est créée par son module
// (_shared/site-events.js, organization_id NOT NULL) ; l'ancienne table globale `events` n'y figure volontairement pas.
export const TENANT_TABLES = ['inscriptions', 'email_log', 'admin_sessions', 'helloasso_orders', 'locations', 'groups', 'group_schedules', 'prices', 'contacts', 'contact_relationships', 'periods', 'memberships', 'group_memberships', 'contact_relationship_sources', 'contact_duplicate_candidates', 'site_configs', 'site_events', 'preinscriptions', 'articles', 'organization_news_state', 'family_links', 'organization_memberships', 'user_tokens', 'admin_audit_log'];
// Tables de la migration 3, figées : une migration déjà en production ne doit jamais changer de comportement.
const PHASE1_TABLES = ['inscriptions', 'email_log', 'admin_sessions'];

async function columnNames(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(results.map((c) => c.name));
}

export const MIGRATIONS = [
  {
    version: 1,
    name: 'organizations',
    statements: (db) => [
      db.prepare(
        `CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'other',
          status TEXT NOT NULL DEFAULT 'active',
          timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
          email TEXT,
          phone TEXT,
          address TEXT,
          settings TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
      // Domaines publics d'une organisation : le site public en déduit l'organisation (resolveOrganization).
      db.prepare(
        `CREATE TABLE IF NOT EXISTS organization_domains (
          domain TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_organization_domains_org ON organization_domains (organization_id)'),
      db.prepare(
        `INSERT OR IGNORE INTO organizations (id, slug, name, type, email, phone, address)
         VALUES (?, 'club-demo', 'Club Démo', 'sports_club', 'contact@clubdemo.licyo.fr', '+33600000000',
                 'Stade municipal, 1 rue du Stade, 00000 Sportville')`
      ).bind(DEMO_ORG_ID),
      ...['clubdemo.licyo.fr', 'www.clubdemo.licyo.fr', 'licyo.pages.dev'].map((domain) =>
        db.prepare('INSERT OR IGNORE INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(domain, DEMO_ORG_ID)
      ),
    ],
  },
  {
    // Les tables email_log et admin_sessions étaient créées chacune par leur module ; elles le sont
    // désormais ici (même définition, IF NOT EXISTS : sans effet sur une base qui les a déjà).
    version: 2,
    name: 'baseline_email_log_admin_sessions',
    statements: (db) => [
      db.prepare(
        `CREATE TABLE IF NOT EXISTS email_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          kind TEXT NOT NULL,
          origin TEXT,
          inscription_id INTEGER,
          recipients TEXT,
          subject TEXT,
          ok INTEGER NOT NULL,
          status INTEGER,
          message_id TEXT,
          error TEXT
        )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log (created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_email_log_inscription ON email_log (inscription_id)'),
      db.prepare('CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)'),
    ],
  },
  {
    // organization_id sur les tables de la phase 1 ; toutes les lignes existantes appartiennent à
    // Club Démo. Colonne nullable (SQLite n'ajoute pas de NOT NULL sans valeur par défaut, et une
    // valeur par défaut rattacherait en silence à Sportville une ligne dont le code aurait oublié
    // l'organisation) : c'est le code qui la renseigne toujours, vérifié par les tests.
    version: 3,
    name: 'organization_id_phase1',
    statements: async (db) => {
      const statements = [];
      for (const table of PHASE1_TABLES) {
        if (!(await columnNames(db, table)).has('organization_id')) {
          statements.push(db.prepare(`ALTER TABLE ${table} ADD COLUMN organization_id TEXT REFERENCES organizations(id)`));
        }
        statements.push(db.prepare(`UPDATE ${table} SET organization_id = ? WHERE organization_id IS NULL`).bind(DEMO_ORG_ID));
      }
      // Index créés seulement si leurs colonnes existent (une base très ancienne peut ne pas les avoir).
      const inscriptionColumns = await columnNames(db, 'inscriptions');
      for (const column of ['created_at', 'dedup_key']) {
        if (inscriptionColumns.has(column)) {
          statements.push(db.prepare(`CREATE INDEX IF NOT EXISTS idx_inscriptions_org_${column} ON inscriptions (organization_id, ${column})`));
        }
      }
      statements.push(
        db.prepare('CREATE INDEX IF NOT EXISTS idx_email_log_org_id ON email_log (organization_id, id)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_email_log_org_inscription ON email_log (organization_id, inscription_id)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_org ON admin_sessions (organization_id)')
      );
      return statements;
    },
  },
  {
    // Consolidation après audit : répare les invariants (tables, colonne organization_id, lignes
    // orphelines, index) sur une base où les migrations 1 à 3 sont enregistrées mais le schéma ne suit
    // pas. Le même contrôle tourne ensuite à chaque démarrage (repairSchemaInvariants, ensureSchema).
    version: 4,
    name: 'repair_tenant_invariants',
    statements: async (db) => {
      // La réparation a sa propre transaction ; la migration n'est enregistrée qu'une fois celle-ci réussie.
      await repairSchemaInvariants(db);
      return [];
    },
  },
  {
    // helloasso_orders rattachée à une organisation : l'anti-rejeu devient (organization_id, order_id),
    // pour qu'une commande d'une organisation ne bloque jamais celle d'une autre. SQLite ne sait pas changer
    // une clé primaire : la table est reconstruite (copie puis remplacement dans la même transaction,
    // aucune ligne perdue ; les commandes existantes sont celles de Sportville).
    // organization_id reste nullable, comme ailleurs : l'ancien code (retour arrière) ne sait pas l'écrire.
    version: 5,
    name: 'helloasso_orders_organization',
    statements: async (db) => {
      const create = (name) =>
        db.prepare(
          `CREATE TABLE ${name} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            organization_id TEXT REFERENCES organizations(id),
            order_id TEXT NOT NULL,
            received_at TEXT NOT NULL DEFAULT (datetime('now')),
            status TEXT NOT NULL,
            inscription_ids TEXT,
            payer_email TEXT,
            detail TEXT,
            UNIQUE (organization_id, order_id)
          )`
        );
      if (!(await tableExists(db, 'helloasso_orders'))) return [create('helloasso_orders')];
      const existing = await columnNames(db, 'helloasso_orders');
      if (existing.has('id') && existing.has('organization_id')) return []; // déjà reconstruite
      const organization = existing.has('organization_id') ? 'COALESCE(organization_id, ?)' : '?';
      return [
        db.prepare('DROP TABLE IF EXISTS helloasso_orders_v5'),
        create('helloasso_orders_v5'),
        db.prepare(
          `INSERT INTO helloasso_orders_v5 (organization_id, order_id, received_at, status, inscription_ids, payer_email, detail)
           SELECT ${organization}, order_id, received_at, status, inscription_ids, payer_email, detail FROM helloasso_orders`
        ).bind(DEMO_ORG_ID),
        db.prepare('DROP TABLE helloasso_orders'),
        db.prepare('ALTER TABLE helloasso_orders_v5 RENAME TO helloasso_orders'),
      ];
    },
  },
  {
    // Phase 2 (site ↔ CRM) : données publiques administrables d'une organisation, source de vérité du
    // site et du formulaire d'inscription (voir _shared/public-data.js). Termes génériques : un « groupe »
    // est une catégorie d'âge au football, un cours de danse ou un atelier de théâtre. Nouvelles tables :
    // organization_id obligatoire (aucun ancien code ne les écrit).
    version: 6,
    name: 'public_data_groups',
    statements: (db) => [
      db.prepare(
        `CREATE TABLE IF NOT EXISTS locations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          address TEXT,
          maps_url TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_locations_org ON locations (organization_id)'),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          birth_year_min INTEGER,
          birth_year_max INTEGER,
          capacity INTEGER,
          is_active INTEGER NOT NULL DEFAULT 1,
          is_public INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          payment_url TEXT,
          payment_widget_url TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (organization_id, slug)
        )`
      ),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS group_schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
          location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
          weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          is_public INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_group_schedules_org ON group_schedules (organization_id, weekday, start_time)'),
      db.prepare(
        `CREATE TABLE IF NOT EXISTS prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
          slug TEXT NOT NULL,
          label TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'EUR',
          is_public INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (organization_id, slug)
        )`
      ),
    ],
  },
  {
    // Phase 2.1 : garde-fous sur les données publiques (voir publicDataGuards). Triggers additifs qui ne
    // touchent à aucune ligne existante, et unicité des créneaux identiques SEULEMENT si aucun doublon n'existe
    // déjà (rien n'est supprimé pour la poser).
    version: 7,
    name: 'public_data_guards',
    statements: (db) => publicDataGuards(db),
  },
  {
    // Phase 3 (fondation CRM) : nouveau modèle personnes / relations / périodes / adhésions, construit À CÔTÉ de
    // la table historique `inscriptions`, qui n'est ni modifiée ni lue en écriture ici. Vocabulaire générique
    // (contacts, periods, memberships, groups), pas de football. Nouvelles tables uniquement : organization_id
    // obligatoire partout, et clés étrangères COMPOSITES (organisation, id) : une adhésion, une relation ou un
    // rattachement de groupe ne peut pas pointer vers une ligne d'une autre organisation. Le remplissage depuis
    // `inscriptions` n'est PAS une migration : voir _shared/crm.js (idempotent, relançable, réconciliable).
    version: 8,
    name: 'crm_core',
    statements: (db) => crmStatements(db, 8),
  },
  {
    // Phase 3.1 (audit Codex) : provenance des relations et candidats de doublon. La migration 8 est déjà appliquée
    // en préproduction : elle n'est pas réécrite, la 9 la complète (relation permanente enfant ↔ responsable,
    // soutenue par une ou plusieurs inscriptions ; provenance recopiée depuis relationships.legacy_inscription_id).
    // Le nombre de tables/index dépend de crm-schema.js, aussi utilisé pour réparer les invariants.
    version: 9,
    name: 'crm_relationship_sources',
    statements: (db) => crmStatements(db, 9),
  },
  {
    // Phase 3.2 : un emplacement d'inscription (responsable 1 ou 2) ne soutient qu'une relation. Additive ; refuse
    // explicitement (sans rien supprimer) si des doublons existent déjà.
    version: 10,
    name: 'crm_relationship_source_slot',
    statements: (db) => crmStatements(db, 10),
  },
  {
    // Phase 4D.2B : configuration du site public (SiteConfig) en base, avec un BROUILLON (édité par l'admin) et
    // une version PUBLIÉE (seule lue par le site public). Une ligne par organisation : la publication est une
    // seule instruction UPDATE (published_* ← draft_*), donc atomique. Nouvelle table, aucune donnée existante
    // touchée ; le remplissage initial (configuration de référence du code, sites/) se fait au premier accès
    // (voir _shared/site-config.js), jamais ici : une migration ne doit pas dépendre d'un contenu qui évolue.
    version: 11,
    name: 'site_configs',
    statements: (db) => siteConfigStatements(db),
  },
  {
    // Phase 4D.2B (durcissement) : marqueur d'initialisation de la configuration du site, conservé HORS de
    // site_configs. Posé dans la même transaction que la première ligne d'une organisation (site-config.js) : une
    // ligne disparue ensuite n'est jamais confondue avec un premier accès (sinon la référence du code serait
    // réimportée et republiée par-dessus le brouillon et la version publiée perdus, sans alerte). Additive :
    // nouvelle colonne nullable ; les organisations qui ont déjà une ligne sont marquées. Plus des garde-fous
    // (triggers, comme la migration 7) : date de publication présente si et seulement si une version est publiée
    // (la migration 11, déjà appliquée ailleurs, n'est pas réécrite).
    version: 12,
    name: 'site_config_initialized',
    statements: (db) => [
      db.prepare('ALTER TABLE organizations ADD COLUMN site_config_initialized_at TEXT'),
      markInitializedStatement(db),
      ...SITE_CONFIGS_TRIGGERS.map(([, sql]) => db.prepare(sql)),
    ],
  },
  {
    // Phase 4E.1 (Actualités CRM) : tables articles et organization_news_state, leurs index et leurs 30 triggers,
    // SQL textuel du contrat 4E v3.1 (voir news-schema.js). ADDITIVE et SANS IMPORT : aucun article n'est créé ici,
    // seule une ligne d'état 'json' par organisation. La source publique des actualités reste le JSON partout.
    version: NEWS_MIGRATION_VERSION,
    name: 'news_articles',
    statements: (db) => newsMigrationStatements(db),
  },
  {
    // Phase 3 de la feuille de route (2026-10-20) : comptes nominatifs (users, globaux à la plateforme), appartenances
    // aux clubs avec un rôle (organization_memberships), jetons d'invitation et de réinitialisation (user_tokens),
    // journal d'audit (admin_audit_log), et compte propriétaire de chaque session admin (admin_sessions.user_id,
    // nullable : les sessions ouvertes avant ne sont plus acceptées, voir admin-auth.js). Additive. Voir accounts.js.
    version: ACCOUNTS_MIGRATION_VERSION,
    name: 'accounts',
    statements: (db) => accountsMigrationStatements(db),
  },
  {
    // Groupes attribués à un compte (entraîneur limité à ses groupes, 2026-10-20). Additive. Voir accounts.js.
    version: GROUP_SCOPE_MIGRATION_VERSION,
    name: 'group-scope',
    statements: (db) => groupScopeMigrationStatements(db),
  },
  {
    // Champs propres au club (grade, ceinture, classement…) : valeurs JSON par inscription. Additive. Voir custom-fields.js.
    version: 16,
    name: 'custom-fields',
    statements: (db) => [db.prepare('ALTER TABLE inscriptions ADD COLUMN custom_fields TEXT')],
  },
];

// Configuration du site : brouillon et version publiée d'une organisation (voir _shared/site-config.js).
// origin = 'reference' tant que la ligne n'a jamais été modifiée depuis l'admin : elle suit alors la
// configuration de référence du code à chaque déploiement ; 'edited' ensuite (le code ne la touche plus).
// Définition exacte de la table : sert à la migration 11 ET au contrôle structurel (checkSiteConfigsTable), qui exige
// que la table en base soit exactement celle-ci. Ne jamais la modifier (migration déjà appliquée) : ajouter une migration.
const SITE_CONFIGS_DEFINITION = `site_configs (
        organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id),
        origin TEXT NOT NULL DEFAULT 'reference' CHECK (origin IN ('reference', 'edited')),
        draft_json TEXT NOT NULL CHECK (json_valid(draft_json)),
        draft_revision INTEGER NOT NULL DEFAULT 1 CHECK (draft_revision >= 1),
        draft_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        published_json TEXT CHECK (published_json IS NULL OR json_valid(published_json)),
        published_revision INTEGER CHECK (published_revision IS NULL OR published_revision >= 1),
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK ((published_json IS NULL) = (published_revision IS NULL))
      )`;

// Garde-fous de la migration 12 : [nom, définition].
const SITE_CONFIGS_TRIGGERS = ['INSERT', 'UPDATE'].map((event) => {
  const name = `site_configs_published_at_${event.toLowerCase()}`;
  return [
    name,
    `CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${event} ON site_configs
     WHEN (NEW.published_json IS NULL) <> (NEW.published_at IS NULL)
     BEGIN SELECT RAISE(ABORT, 'site_configs : date de publication incohérente'); END`,
  ];
});

function siteConfigStatements(db) {
  return [db.prepare(`CREATE TABLE IF NOT EXISTS ${SITE_CONFIGS_DEFINITION}`)];
}

// Marque initialisées les organisations qui ont une ligne site_configs (migration 12 et contrôle au démarrage).
function markInitializedStatement(db) {
  return db.prepare(
    /* toutes-organisations */ `UPDATE organizations SET site_config_initialized_at = (SELECT created_at FROM site_configs s WHERE s.organization_id = organizations.id)
     WHERE site_config_initialized_at IS NULL AND id IN (SELECT organization_id FROM site_configs)`
  );
}


// ---------------------------------------------------------------------------------------------
// Garde-fous des tables de la phase 2. SQLite ne sait pas ajouter une contrainte CHECK à une table
// existante sans la reconstruire : des triggers BEFORE INSERT/UPDATE (IF NOT EXISTS, sans effet sur les
// lignes déjà là) portent les règles stables. Les validations du serveur restent en place.
const TIME_OK = (c) => `${c} GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(${c}, 1, 2) AS INTEGER) <= 23`;
const SCHEDULE_INVALID =
  `NOT (${TIME_OK('NEW.start_time')} AND ${TIME_OK('NEW.end_time')}) OR NEW.start_time >= NEW.end_time ` +
  'OR NEW.weekday NOT BETWEEN 1 AND 7 OR NEW.is_public NOT IN (0, 1)';
const SCHEDULE_MESSAGE = 'Créneau invalide : heures HH:MM avec début avant fin, jour de 1 à 7, is_public 0 ou 1';
const PRICE_INVALID = "typeof(NEW.amount_cents) <> 'integer' OR NEW.amount_cents < 0 OR NEW.is_public NOT IN (0, 1)";
const PRICE_MESSAGE = 'Montant invalide : entier positif ou nul (en centimes), is_public 0 ou 1';
const GROUP_INVALID = 'NEW.is_active NOT IN (0, 1) OR NEW.is_public NOT IN (0, 1)';
const GROUP_MESSAGE = 'Groupe invalide : is_active et is_public valent 0 ou 1';
const GUARD_TRIGGERS = [
  ['group_schedules', 'INSERT', 'trg_group_schedules_valid_ins', SCHEDULE_INVALID, SCHEDULE_MESSAGE],
  ['group_schedules', 'UPDATE', 'trg_group_schedules_valid_upd', SCHEDULE_INVALID, SCHEDULE_MESSAGE],
  ['prices', 'INSERT', 'trg_prices_valid_ins', PRICE_INVALID, PRICE_MESSAGE],
  ['prices', 'UPDATE', 'trg_prices_valid_upd', PRICE_INVALID, PRICE_MESSAGE],
  ['groups', 'INSERT', 'trg_groups_valid_ins', GROUP_INVALID, GROUP_MESSAGE],
  ['groups', 'UPDATE', 'trg_groups_valid_upd', GROUP_INVALID, GROUP_MESSAGE],
];
const SCHEDULE_UNIQUE_INDEX = 'idx_group_schedules_unique';
const SCHEDULE_UNIQUE_COLUMNS = 'organization_id, IFNULL(group_id, 0), IFNULL(location_id, 0), weekday, start_time, end_time';

async function publicDataGuards(db) {
  const existing = new Set((await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger', 'index')").all()).results.map((r) => r.name));
  const statements = [];
  for (const [table, event, name, condition, message] of GUARD_TRIGGERS) {
    if (existing.has(name)) continue;
    statements.push(db.prepare(`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT, '${message}'); END`));
  }
  if (!existing.has(SCHEDULE_UNIQUE_INDEX) && (await tableExists(db, 'group_schedules'))) {
    const columns = await columnNames(db, 'group_schedules');
    const needed = ['organization_id', 'group_id', 'location_id', 'weekday', 'start_time', 'end_time'];
    if (needed.every((c) => columns.has(c))) {
      const duplicates = await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM group_schedules GROUP BY ${SCHEDULE_UNIQUE_COLUMNS} HAVING COUNT(*) > 1)`).first();
      // Des doublons déjà présents : on ne les supprime pas, l'unicité attendra qu'ils soient corrigés à la main.
      if (!duplicates.n) {
        statements.push(db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ${SCHEDULE_UNIQUE_INDEX} ON group_schedules (${SCHEDULE_UNIQUE_COLUMNS})`));
      }
    }
  }
  return statements;
}

// ---------------------------------------------------------------------------------------------
// Invariants du schéma multi-organisation, vérifiés (et réparés si c'est sans ambiguïté) à CHAQUE
// démarrage d'instance, après les migrations : schema_migrations peut dire « appliquée » alors que le
// schéma ne suit plus (table restaurée ou recréée), et un retour temporaire à l'ancien code écrit des
// lignes sans organization_id que la migration 3, déjà enregistrée, ne reprendrait jamais.
// Lignes sans organisation : rattachées à Sportville SEULEMENT si c'est la seule organisation
// existante (ancien code mono-organisation) ; sinon échec explicite, rien n'est deviné.

const TENANT_INDEXES = [
  ['inscriptions', 'idx_inscriptions_org_created_at', 'organization_id, created_at'],
  ['inscriptions', 'idx_inscriptions_org_dedup_key', 'organization_id, dedup_key'],
  ['email_log', 'idx_email_log_org_id', 'organization_id, id'],
  ['email_log', 'idx_email_log_org_inscription', 'organization_id, inscription_id'],
  ['admin_sessions', 'idx_admin_sessions_org', 'organization_id'],
  ['locations', 'idx_locations_org', 'organization_id'],
  ['group_schedules', 'idx_group_schedules_org', 'organization_id, weekday, start_time'],
];

// Tables des données publiques (migration 6) : recréées à l'identique si elles manquent alors que la
// migration est enregistrée. Colonnes qu'on peut ajouter sans risque à une table existante (valeur par
// défaut constante) ; une colonne indispensable et sans défaut possible qui manque = échec explicite.
const PHASE2_TABLES = ['locations', 'groups', 'group_schedules', 'prices'];
const PHASE2_ADDABLE_COLUMNS = {
  locations: { address: 'TEXT', maps_url: 'TEXT', created_at: 'TEXT', updated_at: 'TEXT' },
  groups: {
    description: 'TEXT', birth_year_min: 'INTEGER', birth_year_max: 'INTEGER', capacity: 'INTEGER',
    is_active: 'INTEGER NOT NULL DEFAULT 1', is_public: 'INTEGER NOT NULL DEFAULT 1', sort_order: 'INTEGER NOT NULL DEFAULT 0',
    payment_url: 'TEXT', payment_widget_url: 'TEXT', created_at: 'TEXT', updated_at: 'TEXT',
  },
  group_schedules: {
    group_id: 'INTEGER', location_id: 'INTEGER', is_public: 'INTEGER NOT NULL DEFAULT 1', sort_order: 'INTEGER NOT NULL DEFAULT 0',
    created_at: 'TEXT', updated_at: 'TEXT',
  },
  prices: {
    group_id: 'INTEGER', currency: "TEXT NOT NULL DEFAULT 'EUR'", is_public: 'INTEGER NOT NULL DEFAULT 1', sort_order: 'INTEGER NOT NULL DEFAULT 0',
    created_at: 'TEXT', updated_at: 'TEXT',
  },
};
const PHASE2_REQUIRED_COLUMNS = {
  locations: ['name'],
  groups: ['slug', 'name'],
  group_schedules: ['weekday', 'start_time', 'end_time'],
  prices: ['slug', 'label', 'amount_cents'],
};
// Unicité (organisation, slug) sur laquelle s'appuient les upserts ON CONFLICT.
const PHASE2_UNIQUE = [
  ['groups', 'idx_groups_org_slug'],
  ['prices', 'idx_prices_org_slug'],
];

async function hasUniqueIndexOn(db, table, columns) {
  const { results: indexes } = await db.prepare(`PRAGMA index_list(${table})`).all();
  for (const index of indexes.filter((i) => i.unique)) {
    const { results: info } = await db.prepare(`PRAGMA index_info(${index.name})`).all();
    if (info.length === columns.length && columns.every((c, i) => info[i]?.name === c)) return true;
  }
  return false;
}

async function tableExists(db, name) {
  return Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());
}

export async function repairSchemaInvariants(db) {
  const statements = [];

  // 1. Organisations et domaines (définitions de la migration 1). Sportville n'est recréée que si la
  //    table est vide : dans une base multi-organisation, une organisation supprimée ne revient pas seule.
  const hadOrganizations = await tableExists(db, 'organizations');
  const hadDomains = await tableExists(db, 'organization_domains');
  if (!hadOrganizations || !hadDomains || !(await db.prepare('SELECT 1 FROM organizations LIMIT 1').first())) {
    statements.push(...MIGRATIONS[0].statements(db));
  }
  // Tables des journaux et sessions (définitions de la migration 2).
  if (!(await tableExists(db, 'email_log')) || !(await tableExists(db, 'admin_sessions'))) {
    statements.push(...MIGRATIONS[1].statements(db));
  }

  // 2. Colonne organization_id, puis lignes orphelines.
  const organizationIds = hadOrganizations ? (await db.prepare('SELECT id FROM organizations').all()).results.map((o) => o.id) : [];
  const singleLegacyTenant = organizationIds.length === 0 || (organizationIds.length === 1 && organizationIds[0] === DEMO_ORG_ID);
  for (const table of TENANT_TABLES) {
    const exists = await tableExists(db, table);
    const hasColumn = exists && (await columnNames(db, table)).has('organization_id');
    if (exists && !hasColumn) {
      statements.push(db.prepare(`ALTER TABLE ${table} ADD COLUMN organization_id TEXT REFERENCES organizations(id)`));
    }
    const orphans = !exists
      ? 0
      : (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}${hasColumn ? ' WHERE organization_id IS NULL' : ''}`).first()).n;
    if (!orphans) continue;
    if (!singleLegacyTenant) {
      throw new Error(
        `Schéma incohérent : organization_id manquant sur des lignes de ${table} alors que plusieurs organisations existent ` +
          `(${organizationIds.join(', ')}). Rattachement impossible sans ambiguïté : attribuer ces lignes à la main puis relancer.`
      );
    }
    statements.push(db.prepare(`UPDATE ${table} SET organization_id = ? WHERE organization_id IS NULL`).bind(DEMO_ORG_ID));
  }

  // 2 bis. Tables de la phase 2 : recréées si elles manquent (CREATE ... IF NOT EXISTS de la migration 6),
  //        colonnes ajoutables complétées, unicité (organisation, slug) posée si aucun doublon.
  const phase2Missing = [];
  for (const table of PHASE2_TABLES) if (!(await tableExists(db, table))) phase2Missing.push(table);
  if (phase2Missing.length) statements.push(...(await MIGRATIONS.find((m) => m.version === 6).statements(db)));
  for (const table of PHASE2_TABLES) {
    if (phase2Missing.includes(table)) continue;
    const present = await columnNames(db, table);
    const absentRequired = PHASE2_REQUIRED_COLUMNS[table].filter((c) => !present.has(c));
    if (absentRequired.length) {
      throw new Error(`Schéma incohérent : ${table} n'a plus la colonne ${absentRequired.join(', ')} (non réparable sans deviner) : restaurer la table.`);
    }
    for (const [column, definition] of Object.entries(PHASE2_ADDABLE_COLUMNS[table])) {
      if (!present.has(column)) statements.push(db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`));
    }
  }
  for (const [table, indexName] of PHASE2_UNIQUE) {
    if (phase2Missing.includes(table) || (await hasUniqueIndexOn(db, table, ['organization_id', 'slug']))) continue;
    const key = (await columnNames(db, table)).has('organization_id') ? 'organization_id, slug' : 'slug';
    const duplicates = (await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${table} GROUP BY ${key} HAVING COUNT(*) > 1)`).first()).n;
    if (duplicates) {
      throw new Error(`Schéma incohérent : ${table} contient des doublons (organisation, slug) et n'a pas de contrainte d'unicité : corriger à la main, rien n'a été supprimé.`);
    }
    statements.push(db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${table} (organization_id, slug)`));
  }

  // 2 ter. Objets du CRM (migrations 8 et 9) : chaque table, index et trigger critique est contrôlé
  //        INDÉPENDAMMENT (voir crm-schema.js) ; les index uniques ne sont recréés que sans doublon existant.
  statements.push(...(await repairCrmInvariants(db)));

  // 2 quater. Configuration du site (migrations 11 et 12) : contrôlée, JAMAIS recréée ni remplacée (voir
  //          checkSiteConfigsTable) ; seuls des marqueurs d'initialisation manquants peuvent être posés.
  statements.push(...(await checkSiteConfigsTable(db)));

  // 2 quinquies. Actualités (migration 13) : contrôle du contrat 4E v3.1 §8, seulement si la migration est enregistrée.
  //              Tables, structure et données jamais recréées ni réparées (SchemaIntegrityError) ; seuls des index
  //              nommés ou des triggers ABSENTS sont recréés, dans la transaction ci-dessous.
  if (await migrationRecorded(db, NEWS_MIGRATION_VERSION)) statements.push(...(await checkNewsSchema(db)));

  // 2 sexies. Comptes et rôles (migration 14) : tables, index et colonne admin_sessions.user_id recréés s'ils manquent.
  if (await migrationRecorded(db, ACCOUNTS_MIGRATION_VERSION)) statements.push(...(await repairAccountsInvariants(db, { tableExists, columnNames })));
  if (await migrationRecorded(db, GROUP_SCOPE_MIGRATION_VERSION)) statements.push(...(await repairGroupScopeInvariants(db, { tableExists, columnNames })));
  if ((await migrationRecorded(db, 16)) && (await tableExists(db, 'inscriptions')) && !(await columnNames(db, 'inscriptions')).has('custom_fields')) {
    statements.push(db.prepare('ALTER TABLE inscriptions ADD COLUMN custom_fields TEXT'));
  }

  // 3. Index indispensables aux requêtes filtrées par organisation.
  for (const [table, name, cols] of TENANT_INDEXES) {
    if (!(await tableExists(db, table))) continue;
    const tableColumns = await columnNames(db, table);
    const needed = cols.split(', ').filter((c) => c !== 'organization_id');
    if (!needed.every((c) => tableColumns.has(c))) continue; // base très ancienne : colonne absente
    if (!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first())) {
      statements.push(db.prepare(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${cols})`));
    }
  }

  // 4. Garde-fous de la migration 7 (triggers, unicité des créneaux) : recréés s'ils manquent. Les tables
  //    absentes sont recréées plus haut dans la même transaction, avant ces triggers.
  statements.push(...(await publicDataGuards(db)));

  // Une seule transaction ; rien à faire dans le cas normal (quelques lectures seulement).
  if (statements.length) await db.batch(statements);
  return statements.length;
}

// Configuration du site (migrations 11 et 12). La table est créée par la migration 11 et seulement par elle. Tout écart
// signale une perte ou une altération de données : échec explicite (SchemaIntegrityError), sans rien recréer,
// remplacer, modifier ni réamorcer — recréer la table puis y réimporter la référence du code effacerait sans alerte le
// brouillon et la version publiée réels, et republierait l'ancienne configuration. Restaurer depuis une sauvegarde.
//   - table absente alors que la migration 11 est enregistrée ;
//   - structure différente de la migration : colonnes (nom, ordre, type, NOT NULL, valeur par défaut, clé primaire)
//     lues par PRAGMA table_info, clé étrangère par PRAGMA foreign_key_list, index de clé primaire par
//     PRAGMA index_list / index_info, et définition complète identique à celle de la migration (seul moyen de
//     contrôler les contraintes CHECK, qu'aucun PRAGMA n'expose) ;
//   - lignes qui violent les invariants (JSON valide, révisions ≥ 1, publiée ⇔ révision ⇔ date de publication) ;
//   - migration 12 enregistrée mais colonne de marqueur absente d'organizations, ou garde-fou (trigger) différent.
// Seules réparations automatiques (additives) : poser le marqueur d'initialisation d'une organisation qui A une ligne,
// recréer un garde-fou de la migration 12 manquant.
export const SITE_CONFIGS_COLUMNS = [
  // [nom, type, NOT NULL, valeur par défaut, rang dans la clé primaire]
  ['organization_id', 'TEXT', 1, null, 1],
  ['origin', 'TEXT', 1, "'reference'", 0],
  ['draft_json', 'TEXT', 1, null, 0],
  ['draft_revision', 'INTEGER', 1, '1', 0],
  ['draft_updated_at', 'TEXT', 1, "datetime('now')", 0],
  ['published_json', 'TEXT', 0, null, 0],
  ['published_revision', 'INTEGER', 0, null, 0],
  ['published_at', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, "datetime('now')", 0],
  ['updated_at', 'TEXT', 1, "datetime('now')", 0],
];
const SITE_CONFIGS_FOREIGN_KEYS = [{ table: 'organizations', from: 'organization_id', to: 'id', on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' }];
// normalizeSql et SchemaIntegrityError vivent dans schema-utils.js (sans dépendance) ; réexportés ici pour les
// modules existants.
export { normalizeSql, SchemaIntegrityError };

const migrationRecorded = async (db, version) =>
  (await tableExists(db, 'schema_migrations')) && Boolean(await db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').bind(version).first());

// Écarts de structure entre la table en base et la migration 11 (liste vide : conforme).
export async function siteConfigsStructureProblems(db) {
  const problems = [];
  const { results: columns } = await db.prepare('PRAGMA table_info(site_configs)').all();
  const actual = columns.map((c) => [c.name, String(c.type).toUpperCase(), c.notnull, c.dflt_value, c.pk]);
  for (let i = 0; i < Math.max(actual.length, SITE_CONFIGS_COLUMNS.length); i++) {
    const want = SITE_CONFIGS_COLUMNS[i];
    const got = actual[i];
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      problems.push(`colonne ${i + 1} : attendu ${want ? want.join(' ') : '(aucune)'}, trouvé ${got ? got.join(' ') : '(aucune)'}`);
    }
  }
  const { results: keys } = await db.prepare('PRAGMA foreign_key_list(site_configs)').all();
  const foreign = keys.map(({ table, from, to, on_update, on_delete, match }) => ({ table, from, to, on_update, on_delete, match }));
  if (JSON.stringify(foreign) !== JSON.stringify(SITE_CONFIGS_FOREIGN_KEYS)) problems.push('clé étrangère organization_id → organizations(id) absente ou différente');
  const { results: indexes } = await db.prepare('PRAGMA index_list(site_configs)').all();
  const pkIndex = indexes.find((i) => i.origin === 'pk' && i.unique);
  const pkColumns = pkIndex ? (await db.prepare(`PRAGMA index_info("${pkIndex.name.replace(/"/g, '""')}")`).all()).results.map((c) => c.name) : [];
  if (pkColumns.join(',') !== 'organization_id') problems.push('clé primaire organization_id absente');
  const { sql } = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'site_configs'").first()) || {};
  if (normalizeSql(sql) !== normalizeSql(`CREATE TABLE ${SITE_CONFIGS_DEFINITION}`)) {
    problems.push('définition (contraintes CHECK comprises) différente de la migration 11');
  }
  return problems;
}

// Renvoie les instructions de réparation additives (marqueurs manquants) ; lève SchemaIntegrityError sinon.
async function checkSiteConfigsTable(db) {
  if (!(await tableExists(db, 'site_configs'))) {
    if (!(await migrationRecorded(db, 11))) return []; // migration 11 pas encore appliquée : elle créera la table
    throw new SchemaIntegrityError(
      'Schéma incohérent : la migration 11 est enregistrée mais la table site_configs a disparu. Rien n’a été recréé ' +
        '(le brouillon et la version publiée du site seraient perdus sans alerte) : restaurer la table depuis une sauvegarde.'
    );
  }
  const problems = await siteConfigsStructureProblems(db);
  if (problems.length) {
    throw new SchemaIntegrityError(
      `Schéma incohérent : table site_configs altérée (${problems.join(' ; ')}). Rien n’a été modifié ni supprimé : ` +
        'restaurer la table depuis une sauvegarde.'
    );
  }
  const { n } = await db
    .prepare(
      /* toutes-organisations */ `SELECT COUNT(*) AS n FROM site_configs WHERE origin NOT IN ('reference', 'edited') OR NOT json_valid(draft_json)
         OR draft_revision < 1 OR (published_json IS NOT NULL AND NOT json_valid(published_json)) OR published_revision < 1
         OR (published_json IS NULL) <> (published_revision IS NULL) OR (published_json IS NULL) <> (published_at IS NULL)`
    )
    .first();
  if (n) throw new SchemaIntegrityError(`Données incohérentes : ${n} ligne(s) de site_configs violent ses invariants. Rien n’a été modifié.`);

  // Marqueur d'initialisation (migration 12).
  if (!(await migrationRecorded(db, 12))) return [];
  if (!(await columnNames(db, 'organizations')).has('site_config_initialized_at')) {
    throw new SchemaIntegrityError(
      'Schéma incohérent : la migration 12 est enregistrée mais organizations.site_config_initialized_at a disparu. ' +
        'Rien n’a été recréé (une configuration de site perdue serait alors réamorcée sans alerte) : restaurer la table.'
    );
  }
  const repairs = [];
  const unmarked = await db
    .prepare(/* toutes-organisations */ 'SELECT 1 FROM site_configs s JOIN organizations o ON o.id = s.organization_id WHERE o.site_config_initialized_at IS NULL LIMIT 1')
    .first();
  if (unmarked) repairs.push(markInitializedStatement(db));
  // Garde-fous de la migration 12 : recréés s'ils manquent (additif ; les données viennent d'être contrôlées),
  // échec explicite s'ils existent avec une autre définition.
  for (const [name, sql] of SITE_CONFIGS_TRIGGERS) {
    const existing = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").bind(name).first();
    if (!existing) repairs.push(db.prepare(sql));
    else if (normalizeSql(existing.sql) !== normalizeSql(sql.replace('IF NOT EXISTS ', ''))) {
      throw new SchemaIntegrityError(`Schéma incohérent : garde-fou ${name} différent de la migration 12. Rien n’a été modifié.`);
    }
  }
  return repairs;
}

async function appliedVersions(db) {
  await db
    .prepare("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))")
    .run();
  const { results } = await db.prepare('SELECT version FROM schema_migrations').all();
  return new Set(results.map((r) => r.version));
}

// Applique les migrations manquantes, dans l'ordre. Une erreur interrompt la suite (les migrations
// suivantes peuvent dépendre de celle qui a échoué) et remonte à l'appelant, qui réessaiera.
export async function applyMigrations(db, migrations = MIGRATIONS) {
  let applied = await appliedVersions(db);
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const statements = await migration.statements(db);
    try {
      await db.batch([
        ...statements,
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').bind(migration.version, migration.name),
      ]);
    } catch (error) {
      // Appliquée entre-temps par un autre Worker (la transaction perdante est annulée) : on continue.
      applied = await appliedVersions(db);
      if (!applied.has(migration.version)) throw error;
    }
  }
}
