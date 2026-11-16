// Code Pass'Sport ajouté ou corrigé par la famille depuis son espace /depot/<token> (2026-11-12) : le code arrive
// souvent après l'inscription (envoyé à partir de mi-septembre). Remis en forme et vérifié (_shared/pass-sport.js),
// 50 € retirés du montant à régler (montant dû suivi s'il est déjà enregistré). Le club est prévenu pour vérifier le
// code. Jamais une fois le paiement validé, et jamais si le code suffirait à solder un paiement commencé : la famille
// le présente alors au club (une déclaration ne doit pas pouvoir marquer une fiche payée).
import { getAutomationsConfig } from '../../_shared/settings-kv.js';
import { sendClubPassSportAlert } from '../../_shared/confirmation-email.js';
import { loadFamilyAccess } from '../../_shared/family-links.js';
import { normalizePassSportCode, PASS_SPORT_ERROR } from '../../_shared/pass-sport.js';
import { passSportDueChange } from '../../_shared/payments.js';

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadFamilyAccess(request, env, params.token);
  if (access.status === 'unknown') return new Response('Lien invalide.', { status: 404 });
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: `/depot/${encodeURIComponent(params.token)}` } });
  const { row: inscription, organization } = access;

  const back = (param) => new Response('', { status: 302, headers: { Location: `/depot/${encodeURIComponent(params.token)}?${param}#paiement` } });
  const fail = (message) => back(`passSportError=${encodeURIComponent(message)}`);

  let form;
  try {
    form = await request.formData();
  } catch {
    return fail('Envoi invalide, réessayez.');
  }
  const code = normalizePassSportCode(form.get('passSportCode'));
  if (!code) return fail(code === '' ? "Indiquez votre code Pass'Sport." : PASS_SPORT_ERROR);
  if (inscription.paye) return fail("Le paiement est déjà validé par le club : présentez votre code à un responsable.");
  if (code === inscription.pass_sport_code) return back('passSportOk=1');

  const change = passSportDueChange(inscription, code);
  if (change && change.paye) {
    return fail("Votre code couvre le reste à payer : présentez-le à un responsable du club, qui validera le paiement.");
  }
  try {
    const result = await env.DB.prepare(
      `UPDATE inscriptions SET pass_sport_code = ?, montant_du_cents = ?
       WHERE organization_id = ? AND id = ? AND (paye IS NULL OR paye = 0)
         AND montant_recu_cents IS ? AND montant_du_cents IS ?`
    )
      .bind(code, change ? change.du : inscription.montant_du_cents ?? null, organization.id, inscription.id, inscription.montant_recu_cents ?? null, inscription.montant_du_cents ?? null)
      .run();
    if (!result.meta?.changes) return fail('Votre paiement vient de changer : rechargez la page et réessayez.');
  } catch {
    return fail("Échec de l'enregistrement, réessayez ou écrivez-nous à contact@club-exemple.example.");
  }

  const siteUrl = new URL(request.url).origin;
  waitUntil(
    (async () => {
      try {
        if ((await getAutomationsConfig(env, organization.id)).clubUploadAlerts) {
          await sendClubPassSportAlert(env, { ...inscription, pass_sport_code: code }, siteUrl, inscription.pass_sport_code || '');
        }
      } catch {
        // best-effort
      }
    })()
  );
  return back('passSportOk=1');
}
