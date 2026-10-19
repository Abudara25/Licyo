// Automatisations des inscriptions, activables une par une dans /admin/parametres :
// - afterInscriptionChange() : après chaque dépôt (famille ou admin) et chaque paiement validé (admin
//   ou notification HelloAsso) — alerte au club pour un dépôt fait par une famille, e-mail de suivi à la
//   famille quand le club valide une étape, e-mail "Dossier complet" une seule fois ;
// - runDailyAutomations() : chaque matin via functions/api/cron.js (appelé par le Worker programmé
//   workers/cron, Cloudflare Pages ne sachant pas planifier de tâche) — relances automatiques à J+3 puis
//   J+7 et récapitulatif hebdomadaire le lundi.
import { isInscriptionComplete, isDossierValidated, dossierStatus, familyHasActionPending, hasBirthPlace } from './inscriptions-db.js';
import { getAutomationsConfig, getCategoriesConfig, getCronState, setCronState } from './settings-kv.js';
import { sendFollowUpEmail, sendClubUploadAlert, sendReminderEmail, sendWeeklySummary } from './confirmation-email.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const parseSqlite = (value) => new Date(`${String(value).replace(' ', 'T')}Z`);
// Le dossier ne compte comme validé qu'une fois vérifié par le club (dossier_status = 'valide').
const STEP_DONE = { dossier: isDossierValidated, photo: (r) => r.photo_uploaded_at, paiement: (r) => r.paye, naissance: hasBirthPlace };

// organizationId : organisation de la fiche (session admin, domaine de la page famille ou du webhook) ;
// id : fiche concernée ; before : la fiche lue avant la modification ; step : 'dossier' | 'photo' |
// 'paiement' | 'naissance' ; source : 'famille' | 'admin' | 'helloasso'. Relit la fiche à jour. Ne lève jamais
// d'erreur : appelée via waitUntil, un e-mail raté ne doit pas faire échouer l'action déclenchante.
export async function afterInscriptionChange(env, { organizationId, id, before, step, source, siteUrl }) {
  try {
    const config = await getAutomationsConfig(env, organizationId);
    const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
    if (!row || row.archived_at) return;

    if (source === 'famille' && config.clubUploadAlerts && (step === 'dossier' || step === 'photo')) {
      await sendClubUploadAlert(env, row, siteUrl, step);
    }
    if (!config.familyEmails) return;

    if (isInscriptionComplete(row)) {
      if (!row.complete_notified_at && !(before && isInscriptionComplete(before))) {
        if (await sendFollowUpEmail(env, row, siteUrl, { complete: true })) {
          await env.DB.prepare("UPDATE inscriptions SET complete_notified_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(organizationId, id).run();
        }
      }
      return;
    }

    // Une famille qui dépose elle-même son dossier ou sa photo le voit déjà sur sa page : pas d'e-mail.
    // Pas non plus de nouvel e-mail quand le club remplace un fichier déjà reçu.
    const newlyValidated = STEP_DONE[step](row) && !(before && STEP_DONE[step](before));
    // Lieu de naissance : aucun e-mail d'étape (seul « Dossier complet » ci-dessus peut partir).
    if (source !== 'famille' && newlyValidated && step !== 'naissance') {
      await sendFollowUpEmail(env, row, siteUrl, { step });
    }
  } catch {
    // best-effort
  }
}

// Relances automatiques : au plus 2 par inscription incomplète de la saison en cours, la première 3 jours
// après l'inscription, la seconde à 7 jours, et jamais moins de 3 jours après la relance précédente
// (manuelle comprise, voir last_reminder_at). Plafonnée par passage pour rester raisonnable.
const REMINDER_DAYS = [3, 7];
const MAX_REMINDERS_PER_RUN = 40;

export async function runReminders(env, organizationId, siteUrl, now = new Date()) {
  const { saison } = await getCategoriesConfig(env, organizationId);
  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL').bind(organizationId).all();
  let sent = 0;
  let failed = 0;
  for (const row of results) {
    if (sent + failed >= MAX_REMINDERS_PER_RUN) break;
    if ((row.saison && row.saison !== saison) || !familyHasActionPending(row)) continue;
    const count = Number(row.auto_reminders_sent) || 0;
    if (count >= REMINDER_DAYS.length) continue;
    if ((now - parseSqlite(row.created_at)) / DAY_MS < REMINDER_DAYS[count]) continue;
    if (row.last_reminder_at && (now - parseSqlite(row.last_reminder_at)) / DAY_MS < 3) continue;

    if (await sendReminderEmail(env, row, siteUrl, 'auto')) {
      sent++;
      await env.DB.prepare("UPDATE inscriptions SET auto_reminders_sent = auto_reminders_sent + 1, last_reminder_at = datetime('now') WHERE organization_id = ? AND id = ?")
        .bind(organizationId, row.id)
        .run();
    } else {
      failed++;
    }
  }
  return { sent, failed };
}

export async function buildWeeklySummary(env, organizationId, now = new Date()) {
  const { saison } = await getCategoriesConfig(env, organizationId);
  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL').bind(organizationId).all();
  const active = results.filter((r) => !r.saison || r.saison === saison);
  const weekAgo = now - 7 * DAY_MS;
  return {
    organizationId,
    saison,
    total: active.length,
    complet: active.filter(isInscriptionComplete).length,
    dossierAVerifier: active.filter((r) => dossierStatus(r) === 'a_verifier').length,
    missingDossier: active.filter((r) => ['manquant', 'refuse'].includes(dossierStatus(r))).length,
    missingPhoto: active.filter((r) => !r.photo_uploaded_at).length,
    missingPaiement: active.filter((r) => !r.paye).length,
    nouvelles: active
      .filter((r) => parseSqlite(r.created_at) >= weekAgo)
      .map((r) => ({ id: r.id, name: `${r.enfant_prenom} ${r.enfant_nom}`, categorie: r.categorie, complete: isInscriptionComplete(r) })),
  };
}

const parisDate = (now) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
};

// Organisation déterminée par le domaine appelé par le Worker programmé (functions/api/cron.js).
export async function runDailyAutomations(env, organizationId, siteUrl, now = new Date()) {
  const config = await getAutomationsConfig(env, organizationId);
  const state = await getCronState(env, organizationId);
  const result = { reminders: null, summary: false };

  if (config.autoReminders) {
    result.reminders = await runReminders(env, organizationId, siteUrl, now);
  }

  // Le récapitulatif part le lundi (heure de Paris), une seule fois même si le Worker est relancé.
  const { day, weekday } = parisDate(now);
  if (config.weeklySummary && weekday === 'Mon' && state.lastSummary !== day) {
    if (await sendWeeklySummary(env, siteUrl, await buildWeeklySummary(env, organizationId, now))) {
      state.lastSummary = day;
      result.summary = true;
    }
  }

  await setCronState(env, organizationId, { ...state, lastRun: now.toISOString(), lastResult: result });
  return result;
}
