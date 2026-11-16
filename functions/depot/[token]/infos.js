// Coordonnées et autorisations saisies depuis l'espace famille /depot/<token> (carte « Coordonnées et autorisations »),
// pour une fiche créée par le club depuis une pré-inscription (2026-11-09, _shared/preinscription-transfer.js) : la
// famille n'a pas rempli le formulaire d'inscription, il lui reste à donner adresse, mode de paiement et autorisations
// (mêmes champs et mêmes textes que le formulaire, autorisation de participation et données personnelles
// obligatoires, droit à l'image facultatif). Même protection que la page (jeton secret de la famille, signal de même
// origine vérifié par functions/depot/_middleware.js). Une fois l'inscription complète, correction par le club.
import { isInscriptionComplete } from '../../_shared/inscriptions-db.js';
import { afterInscriptionChange } from '../../_shared/automations.js';
import { loadFamilyAccess } from '../../_shared/family-links.js';

const MAX_LENGTH = 200;
// Valeurs identiques au <select> modePaiement du formulaire d'inscription (PAYMENT_METHODS de functions/api/inscriptions.js).
const MODES_PAIEMENT = ['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque'];

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadFamilyAccess(request, env, params.token);
  if (access.status === 'unknown') return new Response('Lien invalide.', { status: 404 });
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: `/depot/${encodeURIComponent(params.token)}` } });
  const { row: inscription, organization } = access;

  const back = (param) => new Response('', { status: 302, headers: { Location: `/depot/${encodeURIComponent(params.token)}?${param}#infos` } });
  const error = (message) => back(`infosError=${encodeURIComponent(message)}`);

  let form;
  try {
    form = await request.formData();
  } catch {
    return error('Envoi invalide, réessayez.');
  }
  const value = (name) => String(form.get(name) ?? '').trim();
  const adresse = value('adresse');
  const codePostal = value('codePostal');
  const ville = value('ville');
  const mode = value('modePaiement');
  if (!adresse || !codePostal || !ville) return error('Indiquez votre adresse, votre code postal et votre ville.');
  if ([adresse, codePostal, ville].some((v) => v.length > MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(v))) return error('Texte trop long ou invalide.');
  if (!/^\d{5}$/.test(codePostal)) return error('Le code postal doit comporter 5 chiffres.');
  if (!MODES_PAIEMENT.includes(mode)) return error('Choisissez un mode de paiement.');
  if (form.get('autorisation') !== '1' || form.get('rgpd') !== '1') {
    return error("Cochez l'autorisation de participation et l'accord sur les données personnelles : ils sont nécessaires à l'inscription.");
  }
  if (isInscriptionComplete(inscription)) return error("L'inscription est complète : pour modifier ces informations, écrivez au club.");

  try {
    // Le mode de paiement n'est plus modifiable ici une fois le paiement validé par le club.
    await env.DB.prepare(
      `UPDATE inscriptions SET adresse = ?, code_postal = ?, ville = ?, autorisation = 1, rgpd = 1, droit_image = ?,
         mode_paiement = CASE WHEN paye = 1 AND TRIM(COALESCE(mode_paiement, '')) <> '' THEN mode_paiement ELSE ? END
       WHERE organization_id = ? AND id = ?`
    )
      .bind(adresse, codePostal, ville, form.get('droitImage') === '1' ? 1 : 0, mode, organization.id, inscription.id)
      .run();
  } catch {
    return error("Échec de l'enregistrement, réessayez ou écrivez-nous à contact@club-exemple.example.");
  }

  // Peut rendre l'inscription complète : e-mail « Dossier complet » (une seule fois).
  waitUntil(afterInscriptionChange(env, { organizationId: organization.id, id: inscription.id, before: inscription, step: 'infos', source: 'famille', siteUrl: new URL(request.url).origin }));
  return back('infosOk=1');
}
