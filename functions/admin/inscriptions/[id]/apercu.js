// Aperçu du dossier signé dans l'admin, sans quitter l'application. Ouvrir directement le PDF
// (dossier.js) dans un nouvel onglet renvoyait, dans l'admin installée sur Android, vers la
// visionneuse PDF du téléphone, puis vers l'écran d'accueil au retour au lieu de la fiche. Ici le
// PDF est dessiné dans la page par PDF.js (assets/js/admin-apercu.js) et la page s'ouvre dans la
// même fenêtre : le bouton retour ramène à la fiche.
//
// C'est aussi l'écran de VÉRIFICATION (2026-10-08) : on valide ou on refuse le dossier là où on le regarde (à côté du
// document sur ordinateur, dessous sur téléphone), puis on enchaîne sur le dossier suivant à vérifier
// (voir verification.js, champ suite=1). Le bouton « Vérifier le dossier » de la liste mène ici directement.
import { ensureInscriptionsTable, dossierStatus, refusMotifs } from '../../../_shared/inscriptions-db.js';
import { isAuthed, loginPage, adminHead, adminShell, adminScripts, adminBadges, escapeHtml, icon, flash, dossierTag, formatDateFr } from '../../../_shared/admin-auth.js';
import { dossierVerificationForms, DOSSIER_CHECKLIST, verifMessage } from '../../../_shared/admin-dossier.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const LONG_DATE = { day: 'numeric', month: 'long', year: 'numeric' };

export async function onRequestGet({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());

  await ensureInscriptionsTable(env.DB);
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, Number(params.id)).first();
  if (!row) return new Response('Inscription introuvable.', { status: 404 });

  const url = new URL(request.url);
  const fiche = `/admin/inscriptions/${row.id}`;
  const fileUrl = `${fiche}/dossier`;
  const rawName = `${row.enfant_prenom} ${row.enfant_nom}`;
  const name = escapeHtml(rawName);
  const isPdf = row.dossier_content_type === 'application/pdf';
  const dossier = dossierStatus(row);

  const viewer = !row.dossier_key
    ? `<div class="adm-empty">${icon('file')}<p>Aucun dossier reçu pour cette inscription.</p></div>`
    : isPdf
      ? `<div class="adm-viewer" data-pdf="${fileUrl}"><p class="adm-help adm-viewer-status">Chargement du dossier…</p></div>`
      : `<div class="adm-viewer"><img src="${fileUrl}" alt="Dossier signé de ${name}"></div>`;

  // Message de l'action précédente (dossier d'un autre enfant quand on enchaîne) et erreur éventuelle.
  const verifOk = url.searchParams.get('verifOk');
  const verifError = url.searchParams.get('verifError');
  const precedent = Number.parseInt(url.searchParams.get('precedent') || '', 10);
  let previousName = '';
  if (verifOk && Number.isInteger(precedent) && precedent > 0) {
    const prev = await env.DB.prepare('SELECT enfant_prenom, enfant_nom FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, precedent).first();
    if (prev) previousName = `${prev.enfant_prenom} ${prev.enfant_nom}`;
  }
  const flashes = [
    verifOk && (() => {
      const [type, message] = verifMessage(verifOk);
      return flash(type, previousName ? `${previousName} : ${message} Dossier suivant à vérifier ci-dessous.` : message);
    })(),
    verifError && flash('error', verifError),
  ]
    .filter(Boolean)
    .join('');

  const motifs = refusMotifs(row);
  const panel = !row.dossier_key
    ? ''
    : `<aside class="adm-surface adm-apercu-panel" id="verification" aria-label="Vérification du dossier">
      <h2 class="adm-h2">${icon('check')}Vérification</h2>
      <dl class="adm-kv">
        <div><dt>État</dt><dd>${dossierTag(row)}</dd></div>
        <div><dt>Reçu le</dt><dd>${formatDateFr(row.dossier_uploaded_at, LONG_DATE)}</dd></div>
      </dl>
      ${dossier === 'refuse' ? `<p class="adm-help">Refusé le ${formatDateFr(row.dossier_refused_at, LONG_DATE)}${motifs.length ? ` : ${escapeHtml(motifs.join(', ').toLowerCase())}` : ''}. En attente d'un nouveau dépôt de la famille.</p>` : ''}
      ${dossier === 'valide' ? '<p class="adm-help">Dossier déjà validé.</p>' : `<p class="adm-help">${DOSSIER_CHECKLIST}</p>`}
      <div class="adm-verif">
        ${dossierVerificationForms({ self: fiche, dossier, rawName, openRefuse: Boolean(verifError), chain: true, idPrefix: 'apercu-refus' })}
      </div>
      ${dossier === 'a_verifier' ? '<p class="adm-help adm-apercu-next">Après votre choix, le dossier suivant à vérifier s\'ouvre directement.</p>' : ''}
    </aside>`;

  return html(`${adminHead(`Dossier de ${rawName}`)}
${adminShell({
  active: 'inscriptions',
  badges: await adminBadges(env, admin),
  back: { href: fiche, label: 'Retour à la fiche' },
  eyebrow: 'Dossier signé',
  title: name,
})}
<main id="adm-main" class="adm-wrap adm-main">
  ${flashes}
  <div class="adm-surface adm-actionbar">
    <a href="${fiche}#dossier" class="adm-btn adm-btn-ghost adm-apercu-back">${icon('arrowLeft')}Retour à la fiche</a>
    ${row.dossier_key ? `<a href="${fileUrl}?telecharger=1" class="adm-btn adm-btn-ghost" download>${icon('download')}Télécharger</a>` : ''}
    ${row.dossier_key && dossier !== 'valide' ? `<a href="#verification" class="adm-btn adm-btn-primary adm-apercu-jump">${icon('check')}Valider ou refuser</a>` : ''}
  </div>
  <div class="adm-apercu-layout">
    <section class="adm-surface adm-viewer-surface">${viewer}</section>
    ${panel}
  </div>
</main>
${isPdf && row.dossier_key ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" integrity="sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>' : ''}
${adminScripts('admin-nav', 'admin-apercu')}
</body></html>`);
}
