// Changement du mode de paiement depuis l'espace famille /depot/<token> (carte « Paiement de
// l'adhésion », proposée aussi dans l'e-mail de relance). Même protection que la page (le jeton secret
// de la famille). Impossible une fois le paiement validé par le club. Le club est prévenu si les alertes
// de dépôt sont actives (/admin/parametres), puisqu'il attend peut-être un règlement en main propre.
import { getAutomationsConfig } from '../../_shared/settings-kv.js';
import { sendClubPaymentModeAlert } from '../../_shared/confirmation-email.js';
import { loadFamilyAccess } from '../../_shared/family-links.js';

const MODES_PAIEMENT =['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque'];

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadFamilyAccess(request, env, params.token);
  if (access.status === 'unknown') return new Response('Lien invalide.', { status: 404 });
  // Lien expiré ou révoqué : retour sur la page, qui propose d'en recevoir un nouveau par e-mail.
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: `/depot/${encodeURIComponent(params.token)}` } });
  const { row: inscription, organization } = access;

  const back = (param) => new Response('', { status: 302, headers: { Location: `/depot/${encodeURIComponent(params.token)}?${param}#paiement` } });

  let form;
  try {
    form = await request.formData();
  } catch {
    return back(`modeError=${encodeURIComponent('Envoi invalide, réessayez.')}`);
  }
  const mode = String(form.get('modePaiement') || '');
  if (!MODES_PAIEMENT.includes(mode)) {
    return back(`modeError=${encodeURIComponent('Choisissez un mode de paiement.')}`);
  }
  if (inscription.paye) {
    return back(`modeError=${encodeURIComponent('Le paiement est déjà validé par le club : le mode ne peut plus être changé.')}`);
  }
  if (mode === inscription.mode_paiement) return back('modeOk=1');

  try {
    await env.DB.prepare('UPDATE inscriptions SET mode_paiement = ? WHERE organization_id = ? AND id = ? AND (paye IS NULL OR paye = 0)')
      .bind(mode, organization.id, inscription.id)
      .run();
  } catch {
    return back(`modeError=${encodeURIComponent("Échec de l'enregistrement, réessayez ou écrivez-nous à contact@clubdemo.licyo.fr.")}`);
  }

  const siteUrl = new URL(request.url).origin;
  waitUntil(
    (async () => {
      try {
        if ((await getAutomationsConfig(env, organization.id)).clubUploadAlerts) {
          await sendClubPaymentModeAlert(env, { ...inscription, mode_paiement: mode }, siteUrl, inscription.mode_paiement);
        }
      } catch {
        // best-effort
      }
    })()
  );
  return back('modeOk=1');
}
