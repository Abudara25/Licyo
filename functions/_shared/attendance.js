// Présences (2026-10-20) : séances d'un groupe et appel des présents par l'entraîneur.
//
// Tables (migration 17, additive) :
//   - attendance_sessions : une séance = un groupe (libellé de catégorie, comme inscriptions.categorie), une date, une
//     heure ; unique par (organisation, groupe, date, heure) pour qu'un double clic ne crée pas deux séances.
//   - attendance_marks : statut d'un inscrit à une séance (présent, absent, excusé, en retard), une ligne par
//     (organisation, séance, inscription).
// Les inscrits d'une séance sont les fiches ACTIVES de la saison en cours dont la catégorie correspond au groupe
// (libellés comparés comme normalizeGroupLabel). Un compte limité à ses groupes (entraîneur) ne voit et ne fait l'appel
// que de ses groupes (admin.groupScope). Toutes les requêtes filtrent organization_id.
import { normalizeGroupLabel } from './accounts.js';

export const ATTENDANCE_MIGRATION_VERSION = 17;
export const MARK_STATUSES = Object.freeze({ present: 'Présent', late: 'Retard', excused: 'Excusé', absent: 'Absent' });

const DEFINITIONS = [
  [
    'attendance_sessions',
    `CREATE TABLE IF NOT EXISTS attendance_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      group_label TEXT NOT NULL,
      session_date TEXT NOT NULL CHECK (session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      start_time TEXT NOT NULL DEFAULT '' CHECK (start_time = '' OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (organization_id, group_label, session_date, start_time)
    )`,
  ],
  [
    'attendance_marks',
    `CREATE TABLE IF NOT EXISTS attendance_marks (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
      inscription_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('present', 'late', 'excused', 'absent')),
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (organization_id, session_id, inscription_id)
    )`,
  ],
];
const INDEXES = [
  ['idx_attendance_sessions_org_date', 'CREATE INDEX IF NOT EXISTS idx_attendance_sessions_org_date ON attendance_sessions (organization_id, session_date)'],
  ['idx_attendance_marks_org_inscription', 'CREATE INDEX IF NOT EXISTS idx_attendance_marks_org_inscription ON attendance_marks (organization_id, inscription_id)'],
];

export function attendanceMigrationStatements(db) {
  return [...DEFINITIONS.map(([, sql]) => db.prepare(sql)), ...INDEXES.map(([, sql]) => db.prepare(sql))];
}

export async function repairAttendanceInvariants(db, { tableExists }) {
  const statements = [];
  for (const [table, sql] of DEFINITIONS) if (!(await tableExists(db, table))) statements.push(db.prepare(sql));
  for (const [name, sql] of INDEXES) {
    if (!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first())) statements.push(db.prepare(sql));
  }
  return statements;
}

export class AttendanceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AttendanceError';
    this.status = status;
  }
}

const inScope = (scope, label) => !scope || scope.some((g) => normalizeGroupLabel(g) === normalizeGroupLabel(label));

// Date du jour (Europe/Paris) et jour ISO (1 = lundi).
export function todayParis(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday };
}

// Séances prévues aujourd'hui d'après le planning (group_schedules) et pas encore créées : { groupLabel, startTime }.
// Un créneau commun (sans groupe) vaut pour chaque groupe actif.
export async function todaySuggestions(db, organizationId, scope, now = new Date()) {
  const { date, weekday } = todayParis(now);
  const { results: slots } = await db
    .prepare(
      `SELECT s.start_time, g.name AS group_name FROM group_schedules s
       LEFT JOIN groups g ON g.organization_id = s.organization_id AND g.id = s.group_id
       WHERE s.organization_id = ? AND s.weekday = ? ORDER BY s.start_time`
    )
    .bind(organizationId, weekday)
    .all()
    .catch(() => ({ results: [] }));
  if (!slots.length) return [];
  const { results: groups } = await db.prepare('SELECT name FROM groups WHERE organization_id = ? AND is_active = 1 ORDER BY sort_order, id').bind(organizationId).all();
  const { results: existing } = await db.prepare('SELECT group_label, start_time FROM attendance_sessions WHERE organization_id = ? AND session_date = ?').bind(organizationId, date).all();
  const taken = new Set(existing.map((e) => `${normalizeGroupLabel(e.group_label)}|${e.start_time}`));
  const out = [];
  for (const slot of slots) {
    for (const name of slot.group_name ? [slot.group_name] : groups.map((g) => g.name)) {
      const key = `${normalizeGroupLabel(name)}|${slot.start_time}`;
      if (!inScope(scope, name) || taken.has(key)) continue;
      taken.add(key);
      out.push({ groupLabel: name, startTime: slot.start_time, date });
    }
  }
  return out;
}

// Groupes proposés à la création d'une séance (actifs, visibles par le compte).
export async function availableGroups(db, organizationId, scope) {
  const { results } = await db.prepare('SELECT name FROM groups WHERE organization_id = ? AND is_active = 1 ORDER BY sort_order, id').bind(organizationId).all();
  return results.map((g) => g.name).filter((name) => inScope(scope, name));
}

export async function createSession(db, organizationId, { groupLabel, date, startTime = '', title = '', userId = null, scope = null }) {
  const label = String(groupLabel || '').trim().slice(0, 60);
  if (!label) throw new AttendanceError('Groupe requis.');
  if (!inScope(scope, label)) throw new AttendanceError('Ce groupe ne fait pas partie de vos groupes.', 403);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new AttendanceError('Date invalide.');
  const time = String(startTime || '').slice(0, 5);
  if (time && !/^[0-2]\d:[0-5]\d$/.test(time)) throw new AttendanceError('Heure invalide.');
  await db
    .prepare('INSERT OR IGNORE INTO attendance_sessions (organization_id, group_label, session_date, start_time, title, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(organizationId, label, date, time, String(title || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 80), userId)
    .run();
  return db.prepare('SELECT * FROM attendance_sessions WHERE organization_id = ? AND group_label = ? AND session_date = ? AND start_time = ?').bind(organizationId, label, date, time).first();
}

// Séance visible par le compte, ou null (autre club, autre groupe, inexistante).
export async function getSession(db, organizationId, id, scope = null) {
  if (!Number.isInteger(id)) return null;
  const session = await db.prepare('SELECT * FROM attendance_sessions WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
  return session && inScope(scope, session.group_label) ? session : null;
}

export async function listSessions(db, organizationId, scope = null, { limit = 40 } = {}) {
  const { results } = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM attendance_marks m WHERE m.organization_id = s.organization_id AND m.session_id = s.id AND m.status IN ('present', 'late')) AS present_count,
              (SELECT COUNT(*) FROM attendance_marks m WHERE m.organization_id = s.organization_id AND m.session_id = s.id) AS marked_count
       FROM attendance_sessions s WHERE s.organization_id = ? ORDER BY s.session_date DESC, s.start_time DESC, s.id DESC LIMIT 200`
    )
    .bind(organizationId)
    .all();
  return results.filter((s) => inScope(scope, s.group_label)).slice(0, limit);
}

// Inscrits de la séance (fiches actives dont la catégorie correspond au groupe) avec leur statut.
export async function sessionRoster(db, organizationId, session) {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.enfant_prenom, i.enfant_nom, i.naissance, i.categorie, i.photo_uploaded_at, i.photo_key, m.status AS mark
       FROM inscriptions i
       LEFT JOIN attendance_marks m ON m.organization_id = i.organization_id AND m.session_id = ? AND m.inscription_id = i.id
       WHERE i.organization_id = ? AND i.archived_at IS NULL`
    )
    .bind(session.id, organizationId)
    .all();
  const key = normalizeGroupLabel(session.group_label);
  return results
    .filter((r) => normalizeGroupLabel(r.categorie) === key || r.mark)
    .sort((a, b) => a.enfant_nom.localeCompare(b.enfant_nom, 'fr') || a.enfant_prenom.localeCompare(b.enfant_prenom, 'fr'));
}

// Enregistre l'appel : { inscriptionId: statut }. Seuls les inscrits de la séance sont acceptés.
export async function saveMarks(db, organizationId, session, marks, { userId = null, done = true } = {}) {
  const roster = new Set((await sessionRoster(db, organizationId, session)).map((r) => r.id));
  const statements = [];
  for (const [rawId, status] of Object.entries(marks || {})) {
    const id = Number(rawId);
    if (!roster.has(id)) continue;
    if (status === '' || status === null) {
      statements.push(db.prepare('DELETE FROM attendance_marks WHERE organization_id = ? AND session_id = ? AND inscription_id = ?').bind(organizationId, session.id, id));
      continue;
    }
    if (!MARK_STATUSES[status]) throw new AttendanceError('Statut inconnu.');
    statements.push(
      db
        .prepare(
          `INSERT INTO attendance_marks (organization_id, session_id, inscription_id, status, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (organization_id, session_id, inscription_id) DO UPDATE SET status = excluded.status, updated_by = excluded.updated_by, updated_at = datetime('now')`
        )
        .bind(organizationId, session.id, id, status, userId)
    );
  }
  if (done) statements.push(db.prepare("UPDATE attendance_sessions SET status = 'done', updated_at = datetime('now') WHERE organization_id = ? AND id = ? AND status <> 'cancelled'").bind(organizationId, session.id));
  if (statements.length) await db.batch(statements);
  return statements.length;
}

export async function setSessionStatus(db, organizationId, session, status) {
  if (!['planned', 'done', 'cancelled'].includes(status)) throw new AttendanceError('Statut inconnu.');
  await db.prepare("UPDATE attendance_sessions SET status = ?, updated_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(status, organizationId, session.id).run();
}

// Bilan d'un inscrit : séances pointées et présences (présent ou en retard).
export async function attendanceSummary(db, organizationId, inscriptionId) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN m.status IN ('present', 'late') THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN m.status = 'excused' THEN 1 ELSE 0 END) AS excused
       FROM attendance_marks m JOIN attendance_sessions s ON s.organization_id = m.organization_id AND s.id = m.session_id
       WHERE m.organization_id = ? AND m.inscription_id = ? AND s.status <> 'cancelled'`
    )
    .bind(organizationId, inscriptionId)
    .first()
    .catch(() => null);
  return { total: row?.total || 0, present: row?.present || 0, excused: row?.excused || 0 };
}
