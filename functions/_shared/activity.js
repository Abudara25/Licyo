// Journal d'activité d'une inscription (refonte « fiche 360 », 2026-11-13) : une seule frise chronologique qui
// rassemble ce qui est déjà enregistré ailleurs (dates des étapes sur la fiche, historique des versements, journal des
// e-mails). Rien n'est stocké en plus : le journal est recalculé à chaque affichage, il ne peut donc jamais diverger.
import { escapeHtml, icon, formatDateFr } from './admin-auth.js';
import { formatEuros } from './payments.js';
import { EMAIL_KINDS, isClubEmailKind } from './email-log.js';

// Dates SQLite (« 2026-11-04 10:00:00 », UTC), ISO, ou date seule (« 2026-11-04 », jour du paiement).
function toMs(v) {
  if (!v) return NaN;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T12:00:00Z`);
  return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

// Étapes datées de la fiche : [colonne, titre, icône, ton].
const ROW_EVENTS = [
  ['created_at', 'Inscription reçue', 'file', 'neutral'],
  ['dossier_uploaded_at', 'Dossier signé déposé', 'upload', 'neutral'],
  ['dossier_refused_at', 'Dossier signé refusé', 'alert', 'no'],
  ['dossier_verified_at', 'Dossier signé validé', 'check', 'yes'],
  ['photo_uploaded_at', 'Photo reçue', 'camera', 'neutral'],
  ['photo_refused_at', 'Nouvelle photo demandée', 'alert', 'no'],
  ['licence_demandee_at', 'Licence demandée sur Footclubs', 'award', 'neutral'],
  ['licence_famille_at', 'Licence complétée par la famille', 'award', 'neutral'],
  ['licence_verifiee_at', 'Pièces de licence vérifiées', 'award', 'neutral'],
  ['licence_verif_at', 'Licence signée et transmise à la FFF', 'award', 'neutral'],
  ['licence_validee_at', 'Licence validée par la FFF', 'check', 'yes'],
  ['licence_relance_at', 'Relance licence notée', 'send', 'neutral'],
  ['tenue_commandee_at', 'Tenue commandée', 'tag', 'neutral'],
  ['tenue_remise_at', 'Tenue remise', 'check', 'yes'],
  ['archived_at', 'Mise à la corbeille', 'trash', 'no'],
];

/** Événements du plus récent au plus ancien : { at (ms), date (valeur d'origine), title, detail, icon, tone }. */
export function buildActivity(row, { payments = [], emails = [] } = {}) {
  const events = [];
  const push = (date, title, detail, iconName, tone) => {
    const at = toMs(date);
    if (Number.isFinite(at)) events.push({ at, date, title, detail: detail || '', icon: iconName, tone });
  };
  for (const [column, title, iconName, tone] of ROW_EVENTS) {
    let detail = '';
    if (column === 'created_at' && row.mode_paiement) detail = `Mode de paiement choisi : ${row.mode_paiement}`;
    if (column === 'tenue_commandee_at' && row.taille_maillot) detail = `Taille ${row.taille_maillot}`;
    if (column === 'archived_at' && row.archive_commentaire) detail = row.archive_commentaire;
    push(row[column], title, detail, iconName, tone);
  }
  for (const p of payments) {
    if (p.kind === 'versement') {
      push(p.paid_on || p.created_at, `Versement de ${formatEuros(p.amount_cents)}`, [p.mode, `total ${formatEuros(p.total_recu_cents)} sur ${formatEuros(p.total_du_cents)}`].filter(Boolean).join(' · '), 'card', 'yes');
    } else {
      push(p.created_at, 'Montants corrigés', `reçu ${formatEuros(p.total_recu_cents)} sur ${formatEuros(p.total_du_cents)}`, 'edit', 'neutral');
    }
  }
  for (const e of emails) {
    const club = isClubEmailKind(e.kind);
    push(e.created_at, `${club ? 'Alerte club' : 'E-mail'} : ${EMAIL_KINDS[e.kind] || e.subject || 'message'}`, e.ok ? e.subject || '' : `Échec de l’envoi${e.error ? ` : ${e.error}` : ''}`, 'mail', e.ok ? 'neutral' : 'no');
  }
  return events.sort((a, b) => b.at - a.at);
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

export function activitySection(events) {
  if (!events.length) {
    return `<section class="adm-surface adm-activity" id="activite"><h2 class="adm-h2">${icon('activity')}Activité</h2><p class="adm-help">Rien n’est encore enregistré pour cette fiche.</p></section>`;
  }
  let month = '';
  const items = events
    .map((e) => {
      const label = MONTH.format(new Date(e.at));
      const head = label !== month ? `<li class="adm-activity-month">${escapeHtml(label)}</li>` : '';
      month = label;
      const when = /^\d{4}-\d{2}-\d{2}$/.test(String(e.date))
        ? formatDateFr(`${e.date} 12:00:00`, { day: 'numeric', month: 'short' })
        : formatDateFr(e.date, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `${head}<li class="adm-activity-item is-${e.tone}"><span class="adm-activity-ico">${icon(e.icon)}</span><div><strong>${escapeHtml(e.title)}</strong>${e.detail ? `<p>${escapeHtml(e.detail)}</p>` : ''}</div><time>${when}</time></li>`;
    })
    .join('');
  return `<section class="adm-surface adm-activity" id="activite">
    <h2 class="adm-h2">${icon('activity')}Activité</h2>
    <p class="adm-help">Toutes les étapes, versements et e-mails de cette fiche, du plus récent au plus ancien.</p>
    <ol class="adm-activity-list">${items}</ol>
  </section>`;
}
