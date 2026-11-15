// Relances automatiques des dossiers incomplets (tâche planifiée « relances »).
//
// Chaque club décide (clubs.reminder_policy, désactivé par défaut) :
// - quoi relancer : pièces manquantes, correction demandée par le bureau, reste à payer ;
// - quand : jusqu'à 3 étapes, en jours après la création du dossier (ou après la demande de correction).
// Garanties :
// - une même relance (cible, type, étape) n'est envoyée qu'une fois : réservée dans reminder_log AVANT l'envoi,
//   libérée si l'envoi échoue (elle repartira à l'exécution suivante) ;
// - au plus une relance par adresse et par exécution, et 2 jours au moins entre deux relances d'une même cible ;
// - au plus MAX_PER_CLUB_PER_RUN relances par club et par nuit.
//
// Module sans dépendance à Next.js : testé sur SQLite (tests/reminders.test.ts).

import type { SqlDatabase } from './db/query.ts';

export type ReminderKind = 'documents' | 'correction' | 'payment';

export type ReminderPolicy = {
  enabled: boolean;
  delaysDays: number[];
  kinds: Record<ReminderKind, boolean>;
};

export const DEFAULT_POLICY: ReminderPolicy = {
  enabled: false,
  delaysDays: [3, 7, 14],
  kinds: { documents: true, correction: true, payment: true },
};

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  documents: 'Pièces manquantes',
  correction: 'Correction demandée',
  payment: 'Reste à payer',
};

export const MAX_STEPS = 3;
export const MAX_PER_CLUB_PER_RUN = 100;
const MIN_GAP_DAYS = 2;
const DAY = 86400000;

/** Lit les réglages d'un club en tolérant une valeur absente ou incomplète (jamais d'erreur). */
export function parseReminderPolicy(raw: unknown): ReminderPolicy {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const delays = Array.isArray(o.delaysDays)
    ? [...new Set(o.delaysDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => a - b).slice(0, MAX_STEPS)
    : DEFAULT_POLICY.delaysDays;
  const k = o.kinds && typeof o.kinds === 'object' ? (o.kinds as Record<string, unknown>) : {};
  const flag = (key: ReminderKind) => (typeof k[key] === 'boolean' ? (k[key] as boolean) : DEFAULT_POLICY.kinds[key]);
  return {
    enabled: o.enabled === true,
    delaysDays: delays.length ? delays : DEFAULT_POLICY.delaysDays,
    kinds: { documents: flag('documents'), correction: flag('correction'), payment: flag('payment') },
  };
}

export type MemberRow = {
  id: string;
  club_id: string;
  family_id: string | null;
  first_name: string;
  dossier_status: string;
  photo_storage_path: string | null;
  medical_doc_storage_path: string | null;
  health_questionnaire_passed: number | boolean;
  rejection_reason: string | null;
  magic_action_token: string;
  created_at: string;
  medical_requirement: string | null;
  payer_email: string | null;
  payer_first_name: string | null;
};

/** Pièces encore attendues pour un dossier en cours de vérification. */
export function missingDocuments(m: Pick<MemberRow, 'photo_storage_path' | 'medical_doc_storage_path' | 'health_questionnaire_passed' | 'medical_requirement'>): string[] {
  const out: string[] = [];
  if (!m.photo_storage_path) out.push('photo d’identité');
  const certificateRequired = (m.medical_requirement ?? 'health_questionnaire') !== 'health_questionnaire' || !m.health_questionnaire_passed;
  if (certificateRequired && !m.medical_doc_storage_path) out.push('certificat médical');
  return out;
}

export type PlannedReminder = {
  clubId: string;
  targetType: 'member' | 'family';
  targetId: string;
  kind: ReminderKind;
  step: number;
  recipient: string;
  firstName: string;
  /** Prénom de l'adhérent ou noms des adhérents concernés. */
  subject: string;
  details: string[];
  token?: string;
  amountDue?: number;
};

type Row = Record<string, unknown>;
const all = async <T = Row>(db: SqlDatabase, sql: string, ...params: unknown[]) =>
  ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];

/** Étape due pour une cible, ou null. */
export function dueStep(opts: { now: Date; base: string; delaysDays: number[]; sentSteps: number; lastSentAt: string | null }): number | null {
  const next = opts.sentSteps + 1;
  if (next > opts.delaysDays.length) return null;
  const t = opts.now.getTime();
  if (t < new Date(opts.base).getTime() + opts.delaysDays[next - 1] * DAY) return null;
  if (opts.lastSentAt && t < new Date(opts.lastSentAt).getTime() + MIN_GAP_DAYS * DAY) return null;
  return next;
}

/** Relances dues pour un club (aucun envoi : planification seulement). */
export async function planClubReminders(db: SqlDatabase, club: { id: string; current_season: string; reminder_policy: unknown }, now: Date): Promise<PlannedReminder[]> {
  const policy = parseReminderPolicy(typeof club.reminder_policy === 'string' ? JSON.parse(club.reminder_policy) : club.reminder_policy);
  if (!policy.enabled) return [];
  const logs = await all<{ target_id: string; kind: ReminderKind; n: number; last: string }>(
    db,
    'SELECT target_id, kind, count(*) AS n, max(sent_at) AS last FROM reminder_log WHERE club_id = ? GROUP BY target_id, kind',
    club.id,
  );
  const sent = (targetId: string, kind: ReminderKind) => logs.find((l) => l.target_id === targetId && l.kind === kind);
  const planned: PlannedReminder[] = [];
  const consider = (p: Omit<PlannedReminder, 'step'>, base: string) => {
    const log = sent(p.targetId, p.kind);
    const step = dueStep({ now, base, delaysDays: policy.delaysDays, sentSteps: Number(log?.n ?? 0), lastSentAt: log?.last ?? null });
    if (step) planned.push({ ...p, step });
  };

  if (policy.kinds.documents || policy.kinds.correction) {
    const members = await all<MemberRow>(
      db,
      `SELECT m.id, m.club_id, m.family_id, m.first_name, m.dossier_status, m.photo_storage_path, m.medical_doc_storage_path,
              m.health_questionnaire_passed, m.rejection_reason, m.magic_action_token, m.created_at,
              c.medical_requirement, f.payer_email, f.payer_first_name
       FROM members m LEFT JOIN categories c ON c.id = m.category_id LEFT JOIN family_registrations f ON f.id = m.family_id
       WHERE m.club_id = ? AND m.season = ? AND m.dossier_status IN ('pending_review','needs_correction')`,
      club.id,
      club.current_season,
    );
    for (const m of members) {
      if (!m.payer_email) continue;
      const common = { clubId: club.id, targetType: 'member' as const, targetId: m.id, recipient: m.payer_email, firstName: m.payer_first_name ?? '', subject: m.first_name, token: m.magic_action_token };
      if (m.dossier_status === 'pending_review' && policy.kinds.documents) {
        const missing = missingDocuments(m);
        if (missing.length) consider({ ...common, kind: 'documents', details: missing }, m.created_at);
      }
      if (m.dossier_status === 'needs_correction' && policy.kinds.correction) {
        // Délai compté depuis la demande de correction (e-mail envoyé par le bureau), sinon depuis le dossier.
        const asked = await all<{ at: string }>(
          db,
          "SELECT max(created_at) AS at FROM email_log WHERE club_id = ? AND kind = 'correction_demandee' AND recipient = ?",
          club.id,
          m.payer_email.toLowerCase(),
        );
        consider({ ...common, kind: 'correction', details: m.rejection_reason ? [m.rejection_reason] : [] }, asked[0]?.at ?? m.created_at);
      }
    }
  }

  if (policy.kinds.payment) {
    const families = await all<{ id: string; payer_email: string; payer_first_name: string; final_total_amount: number; amount_paid: number; created_at: string; scheduled: number; names: string }>(
      db,
      `SELECT f.id, f.payer_email, f.payer_first_name, f.final_total_amount, f.amount_paid, f.created_at,
              (SELECT coalesce(sum(i.amount), 0) FROM payment_installments i WHERE i.family_id = f.id AND i.status IN ('pending','deposited')) AS scheduled,
              (SELECT group_concat(m.first_name, ', ') FROM members m WHERE m.family_id = f.id AND m.dossier_status NOT IN ('rejected')) AS names
       FROM family_registrations f
       WHERE f.club_id = ? AND f.season = ? AND f.payment_status IN ('unpaid','partial')`,
      club.id,
      club.current_season,
    );
    for (const f of families) {
      // Chèques déjà remis (encaissement programmé) : pas de relance pour ce montant.
      const due = Math.round((Number(f.final_total_amount) - Number(f.amount_paid) - Number(f.scheduled)) * 100) / 100;
      if (due < 1) continue;
      consider(
        { clubId: club.id, targetType: 'family', targetId: f.id, kind: 'payment', recipient: f.payer_email, firstName: f.payer_first_name, subject: f.names ?? '', details: [], amountDue: due },
        f.created_at,
      );
    }
  }

  // Une seule relance par adresse et par exécution (la plus ancienne étape d'abord), et un plafond par club.
  const seen = new Set<string>();
  return planned
    .sort((a, b) => a.step - b.step)
    .filter((p) => {
      const key = p.recipient.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_PER_CLUB_PER_RUN);
}

export type ReminderSender = (reminder: PlannedReminder) => Promise<void>;

/** Tâche planifiée : planifie et envoie les relances de tous les clubs qui les ont activées. */
export async function runReminders(db: SqlDatabase, now: Date, send: ReminderSender): Promise<string> {
  const clubs = await all<{ id: string; current_season: string; reminder_policy: string }>(
    db,
    "SELECT id, current_season, reminder_policy FROM clubs WHERE status IN ('active','demo') AND json_extract(reminder_policy, '$.enabled') = 1",
  );
  let sentCount = 0;
  let failures = 0;
  for (const club of clubs) {
    for (const r of await planClubReminders(db, club, now)) {
      // Réservation avant l'envoi : deux exécutions concurrentes n'envoient jamais la même relance.
      const id = crypto.randomUUID();
      const claim = await db
        .prepare('INSERT INTO reminder_log (id, club_id, target_type, target_id, kind, step, recipient, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (target_id, kind, step) DO NOTHING')
        .bind(id, r.clubId, r.targetType, r.targetId, r.kind, r.step, r.recipient.toLowerCase(), now.toISOString())
        .run();
      if (Number(claim.meta?.changes ?? 0) === 0) continue;
      try {
        await send(r);
        sentCount++;
      } catch {
        await db.prepare('DELETE FROM reminder_log WHERE id = ?').bind(id).run();
        failures++;
      }
    }
  }
  return `clubs=${clubs.length} envoyees=${sentCount} echecs=${failures}`;
}
