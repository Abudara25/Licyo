// Import de l'export Footclubs (2026-11-04) : /admin/adherents/footclubs. Trois temps sans boîte de dialogue :
// dépôt du fichier → récapitulatif (ce qui va changer, enfants non retrouvés, statuts inconnus) → confirmation.
// Le fichier n'est jamais stocké : il est lu en mémoire au dépôt ; la confirmation renvoie seulement les cibles
// calculées (identifiant de fiche + champs de suivi), revérifiées côté serveur. Organisation : celle de la session.
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { isAuthed, loginPage, adminHead, adminShell, adminScripts, adminBadges, escapeHtml, icon, flash } from '../../_shared/admin-auth.js';
import { html } from '../../_shared/crm-ui.js';
import { LICENCE_STAGES } from '../../_shared/club-followup.js';
import {
  readXlsxRows,
  footclubsRecords,
  planFootclubsImport,
  sanitizeTargets,
  footclubsStatements,
  FootclubsFileError,
  MAX_FILE_BYTES,
} from '../../_shared/footclubs-import.js';

const BACK = { href: '/admin/adherents', label: 'Adhérents' };

function page(title, body, badges) {
  return `${adminHead(title)}
${adminShell({ active: 'adherents', badges, back: BACK, eyebrow: 'Licences FFF', title: 'Importer l’export Footclubs', subtitle: 'Met à jour l’étape de chaque licence, les pièces manquantes et le n° de licence.' })}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
${body}
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

function uploadForm(error = '') {
  return `${error ? flash('error', error) : ''}
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('upload')}Déposer le fichier</h2>
    <ol class="adm-fc-howto">
      <li>Sur Footclubs, exportez la liste des demandes de licence au format Excel (fichier du type « export_dossier.xlsx »).</li>
      <li>Déposez-le ici : le site retrouve chaque joueur par son nom, son prénom et sa date de naissance.</li>
      <li>Vérifiez le récapitulatif, puis confirmez. Rien n’est modifié avant.</li>
    </ol>
    <form method="POST" enctype="multipart/form-data" class="adm-fc-form" data-once>
      <input type="hidden" name="action" value="preview">
      <label for="fc-file" class="adm-fc-label">Fichier Excel (.xlsx)</label>
      <input type="file" id="fc-file" name="fichier" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
      <button type="submit" class="adm-btn adm-btn-primary">${icon('eye')}Voir ce qui va changer</button>
    </form>
    <p class="adm-help">Le fichier n’est pas conservé. Seuls les joueurs sont lus (les dirigeants sont ignorés), et seules les colonnes nom, prénom, date de naissance, statut, pièces manquantes et numéro personne.</p>
  </section>`;
}

const stageTag = (key) => `<span class="adm-tag is-${LICENCE_STAGES[key].tone}">${escapeHtml(LICENCE_STAGES[key].short)}</span>`;

function previewBody(plan) {
  const n = plan.updates.length;
  const list = (items, render) => `<ul class="adm-fc-list">${items.map(render).join('')}</ul>`;
  const birth = (iso) => (iso ? ` <small>né(e) le ${escapeHtml(iso.split('-').reverse().join('/'))}</small>` : '');
  const updates = n
    ? `<section class="adm-surface">
    <h2 class="adm-h2">${icon('refresh')}${n} fiche${n > 1 ? 's' : ''} à mettre à jour</h2>
    <ul class="adm-fc-updates">${plan.updates
      .map(
        (u) => `<li>
        <p class="adm-fc-child"><strong>${escapeHtml(u.child)}</strong><span class="adm-fc-stages">${stageTag(u.before)}${icon('chevron')}${stageTag(u.after)}</span></p>
        <ul class="adm-fc-changes">${u.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
        ${u.unknownDocs.length ? `<p class="adm-fc-warn">${icon('alert')}Pièce non reconnue, à noter à la main : ${escapeHtml(u.unknownDocs.join(', '))}</p>` : ''}
      </li>`
      )
      .join('')}</ul>
    <form method="POST" class="adm-form-actions" data-once>
      <input type="hidden" name="action" value="apply">
      <input type="hidden" name="cibles" value="${escapeHtml(JSON.stringify(plan.updates.map((u) => ({ id: u.id, target: u.target }))))}">
      <button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Appliquer les ${n} mise${n > 1 ? 's' : ''} à jour</button>
      <a href="/admin/adherents/footclubs" class="adm-btn adm-btn-ghost">Annuler</a>
    </form>
  </section>`
    : `<section class="adm-surface">${flash('ok', 'Tout est déjà à jour : aucune fiche à modifier.')}<p><a href="/admin/adherents" class="adm-btn adm-btn-ghost">Retour aux adhérents</a></p></section>`;

  const notes = [
    plan.notFound.length &&
      `<h3>${icon('alert')}${plan.notFound.length} joueur${plan.notFound.length > 1 ? 's' : ''} non retrouvé${plan.notFound.length > 1 ? 's' : ''} dans les inscriptions</h3>
      <p class="adm-help">Nom, prénom ou date de naissance différents entre Footclubs et le site, ou inscription archivée. Corrigez la fiche, puis réimportez.</p>
      ${list(plan.notFound, (r) => `<li>${escapeHtml(r.label)}${birth(r.naissance)} · ${escapeHtml(r.statut)}</li>`)}`,
    plan.ambiguous.length &&
      `<h3>${icon('alert')}${plan.ambiguous.length} cas ambigu${plan.ambiguous.length > 1 ? 's' : ''} (plusieurs fiches possibles), non modifié${plan.ambiguous.length > 1 ? 's' : ''}</h3>
      ${list(plan.ambiguous, (r) => `<li>${escapeHtml(r.label)}${birth(r.naissance)}</li>`)}`,
    plan.unknownStatus.length &&
      `<h3>${icon('alert')}Statut Footclubs inconnu, non modifié</h3>
      <p class="adm-help">Signalez ce statut pour qu’il soit pris en compte.</p>
      ${list(plan.unknownStatus, (r) => `<li>${escapeHtml(r.label)} · « ${escapeHtml(r.statut)} »</li>`)}`,
    plan.conflicts.length &&
      `<h3>${icon('alert')}N° de licence différent de celui de la fiche (non remplacé)</h3>
      ${list(plan.conflicts, (r) => `<li>${escapeHtml(r.label)} · fiche : ${escapeHtml(r.saved)}</li>`)}`,
  ].filter(Boolean);

  return `${updates}
  <section class="adm-surface adm-fc-notes">
    <p class="adm-help">${plan.unchanged} fiche${plan.unchanged > 1 ? 's' : ''} déjà à jour · ${plan.ignored} ligne${plan.ignored > 1 ? 's' : ''} ignorée${plan.ignored > 1 ? 's' : ''} (dirigeants)</p>
    ${notes.join('')}
  </section>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  return html(page('Importer l’export Footclubs', uploadForm(), await adminBadges(env, admin)));
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const badges = await adminBadges(env, admin);
  const form = await request.formData();
  const action = String(form.get('action') || '');
  await ensureSchema(env.DB);

  if (action === 'apply') {
    const targets = sanitizeTargets(form.get('cibles'));
    if (!targets) return html(page('Importer l’export Footclubs', uploadForm('Récapitulatif invalide : déposez de nouveau le fichier.'), badges), 400);
    const results = targets.length ? await env.DB.batch(footclubsStatements(env.DB, admin.organizationId, targets)) : [];
    const changed = results.reduce((n, r) => n + (r?.meta?.changes || 0), 0);
    return new Response('', { status: 303, headers: { Location: `/admin/adherents?footclubs=${changed}` } });
  }

  const file = form.get('fichier');
  if (!file || typeof file === 'string' || !file.size) return html(page('Importer l’export Footclubs', uploadForm('Choisissez le fichier exporté de Footclubs.'), badges), 400);
  if (file.size > MAX_FILE_BYTES) return html(page('Importer l’export Footclubs', uploadForm('Fichier trop volumineux (2 Mo au plus).'), badges), 400);
  try {
    const records = footclubsRecords(await readXlsxRows(new Uint8Array(await file.arrayBuffer())));
    const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL').bind(admin.organizationId).all();
    return html(page('Vérifier l’import Footclubs', previewBody(planFootclubsImport(records, results)), badges));
  } catch (error) {
    if (error instanceof FootclubsFileError) return html(page('Importer l’export Footclubs', uploadForm(error.message), badges), 400);
    throw error;
  }
}
