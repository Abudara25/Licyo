// Import des paiements HelloAsso (2026-11-13) : /admin/helloasso. Trois temps sans boîte de dialogue, comme l'import
// Footclubs : dépôt de l'export « paiements » (.xlsx) → une ligne par paiement avec l'adhérent proposé (modifiable)
// → confirmation. Le fichier n'est jamais stocké ; la confirmation renvoie les paiements (référence, montant, date,
// type) et le choix fait pour chacun, revérifiés côté serveur. Organisation : celle de la session.
import { ensureSchema, hasPaymentStarted } from '../_shared/inscriptions-db.js';
import { isAuthed, loginPage, adminHead, adminShell, adminScripts, adminBadges, escapeHtml, icon, flash, formatBirth } from '../_shared/admin-auth.js';
import { html } from '../_shared/crm-ui.js';
import { readXlsxRows, MAX_FILE_BYTES } from '../_shared/footclubs-import.js';
import { getCategoriesConfig } from '../_shared/settings-kv.js';
import { formatEuros } from '../_shared/payments.js';
import { afterInscriptionChange } from '../_shared/automations.js';
import { syncInscriptionSafe } from '../_shared/crm.js';
import {
  XlsxFileError,
  helloAssoRecords,
  planHelloAssoImport,
  ensureHelloAssoPaymentsTable,
  sanitizeLines,
  parseChoice,
  lineKind,
  applyPayment,
  markStatement,
  resetStatement,
  fichLabel,
} from '../_shared/helloasso-import.js';

const TITLE = 'Importer les paiements HelloAsso';

function page(title, body, badges) {
  return `${adminHead(title)}
${adminShell({ active: 'dashboard', badges, back: { href: '/admin/dashboard#ov-finances', label: 'Vue d’ensemble' }, eyebrow: 'Finances', title: TITLE, subtitle: 'Paiements en plusieurs fois, paiements en ligne et carte bancaire au club (Tap to pay) : chaque paiement est rattaché à son adhérent.' })}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
${body}
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

function uploadForm(message = '') {
  return `${message}
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('upload')}Déposer le fichier</h2>
    <ol class="adm-fc-howto">
      <li>Sur HelloAsso : Mon espace › Paiements, choisissez la période, puis « Exporter » au format Excel.</li>
      <li>Déposez le fichier ici : chaque paiement est proposé avec l’adhérent retrouvé (commande, e-mail ou nom du payeur).</li>
      <li>Pour les paiements sans nom (carte bancaire au club), choisissez l’adhérent dans la liste. Rien n’est modifié avant la confirmation.</li>
    </ol>
    <form method="POST" enctype="multipart/form-data" class="adm-fc-form" data-once>
      <input type="hidden" name="action" value="preview">
      <label for="ha-file" class="adm-fc-label">Fichier Excel (.xlsx)</label>
      <input type="file" id="ha-file" name="fichier" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required>
      <button type="submit" class="adm-btn adm-btn-primary">${icon('eye')}Voir les paiements</button>
    </form>
    <p class="adm-help">Le fichier n’est pas conservé. Un paiement déjà importé n’est jamais compté deux fois : vous pouvez réimporter chaque mois un export qui reprend les mêmes dates.</p>
  </section>`;
}

const kindLabel = (l) => (l.tap ? 'Carte bancaire au club' : l.plan ? `Échéance${l.rank ? ` ${l.rank}` : ''} · en plusieurs fois` : 'Paiement en ligne');
const ficheOption = (r) => `${fichLabel(r)}${r.categorie ? ` (${r.categorie})` : ''}`;

function choiceSelect(l, fiches, name) {
  const opt = (value, label) => `<option value="${escapeHtml(value)}"${value === l.choice ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  return `<select id="${name}" name="${name}" class="adm-select">
    ${opt('', 'À décider plus tard')}
    <optgroup label="Ajouter le versement à…">${fiches.map((r) => opt(`add:${r.id}`, ficheOption(r))).join('')}</optgroup>
    <optgroup label="Déjà saisi à la main sur… (rien n’est ajouté)">${fiches.map((r) => opt(`link:${r.id}`, ficheOption(r))).join('')}</optgroup>
    ${opt('ignore', 'Pas une adhésion (don, vente, test) : ne plus proposer')}
  </select>`;
}

const DONE = { applied: 'Importé sur', linked: 'Déjà saisi sur', ignored: 'Écarté (pas une adhésion)' };

function previewBody(plan, fiches, invalid) {
  const byId = new Map(fiches.map((r) => [r.id, r]));
  const todo = plan.lines.filter((l) => !l.done);
  const done = plan.lines.filter((l) => l.done);
  const payer = (l) =>
    l.payer ? escapeHtml(`${l.payer.prenom} ${l.payer.nom}`.trim()) : `<em>${l.tap ? 'Sans nom (Tap to pay)' : 'Payeur non renseigné'}</em>`;
  const head = (l) => `<p class="adm-fc-child"><strong>${formatEuros(l.cents)} · ${escapeHtml(formatBirth(l.date))}</strong><span class="adm-tag">${escapeHtml(kindLabel(l))}</span></p>
        <p class="adm-help">${payer(l)}${l.campagne ? ` · ${escapeHtml(l.campagne)}` : ''}</p>`;
  const rows = todo
    .map((l, i) => {
      const name = `choix-${i}`;
      return `<li>
        ${head(l)}
        <label class="adm-field" for="${name}">Adhérent${l.why ? ` <small>(${escapeHtml(l.why)})</small>` : ''}
          ${choiceSelect(l, fiches, name)}
        </label>
      </li>`;
    })
    .join('');
  const doneRows = done
    .map((l, i) => {
      const fiche = l.done.inscriptionId && byId.get(l.done.inscriptionId);
      const where = fiche ? ` <a href="/admin/inscriptions/${fiche.id}#versement">${escapeHtml(fichLabel(fiche))}</a>` : '';
      const reset =
        l.done.status === 'applied'
          ? ''
          : `<label class="adm-check"><input type="checkbox" name="reset-${i}" value="1"> Remettre à décider</label>`;
      return `<li>${head(l)}<p class="adm-help">${icon('check')}${escapeHtml(DONE[l.done.status])}${where}</p>${reset}</li>`;
    })
    .join('');
  const payload = (list) => escapeHtml(JSON.stringify(list.map((l) => ({ ref: l.ref, order: l.order, cents: l.cents, date: l.date, kind: lineKind(l) }))));
  const toDecide = todo.filter((l) => !l.choice).length;

  return `<section class="adm-surface">
    <p class="adm-help">${plan.lines.length} paiement${plan.lines.length > 1 ? 's' : ''} encaissé${plan.lines.length > 1 ? 's' : ''} · ${formatEuros(plan.total)} · ${done.length} déjà traité${done.length > 1 ? 's' : ''}${plan.skipped.length ? ` · ${plan.skipped.length} non payé${plan.skipped.length > 1 ? 's' : ''} (remboursé, refusé…) ignoré${plan.skipped.length > 1 ? 's' : ''}` : ''}${invalid ? ` · ${invalid} ligne${invalid > 1 ? 's' : ''} illisible${invalid > 1 ? 's' : ''}` : ''}</p>
  </section>
  <form method="POST" data-once>
    <input type="hidden" name="action" value="apply">
    <input type="hidden" name="lignes" value="${payload(todo)}">
    <input type="hidden" name="traites" value="${payload(done)}">
    ${
      todo.length
        ? `<section class="adm-surface">
    <h2 class="adm-h2">${icon('card')}${todo.length} paiement${todo.length > 1 ? 's' : ''} à rattacher${toDecide ? ` <small>· ${toDecide} sans adhérent proposé</small>` : ''}</h2>
    <p class="adm-help">Vérifiez l’adhérent proposé pour chaque paiement. « Ajouter le versement » l’inscrit dans l’historique des versements de la fiche et met à jour le total reçu ; un paiement en plusieurs fois rend la fiche « payée » dès la première échéance (HelloAsso prélève les suivantes). Choisissez « Déjà saisi à la main » si vous l’aviez enregistré vous-même sur la fiche.</p>
    <ul class="adm-fc-updates">${rows}</ul>
  </section>`
        : `<section class="adm-surface">${flash('ok', 'Tous les paiements de ce fichier sont déjà traités.')}</section>`
    }
    ${
      done.length
        ? `<details class="adm-surface adm-fold"><summary class="adm-h2">${icon('check')}${done.length} paiement${done.length > 1 ? 's' : ''} déjà traité${done.length > 1 ? 's' : ''}</summary><ul class="adm-fc-updates">${doneRows}</ul></details>`
        : ''
    }
    <div class="adm-form-actions">
      <button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button>
      <a href="/admin/helloasso" class="adm-btn adm-btn-ghost">Annuler</a>
    </div>
    <p class="adm-help">Une fiche qui reçoit son premier paiement suit la même suite que « Marquer payé » (e-mail de suivi à la famille). Aucun autre e-mail n’est envoyé.</p>
  </form>`;
}

async function loadContext(env, organizationId) {
  await ensureHelloAssoPaymentsTable(env.DB);
  const [fiches, known, entries] = await Promise.all([
    env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL ORDER BY enfant_prenom COLLATE NOCASE, enfant_nom COLLATE NOCASE').bind(organizationId).all(),
    env.DB.prepare('SELECT payment_ref, order_ref, status, inscription_id FROM helloasso_payments WHERE organization_id = ?').bind(organizationId).all(),
    env.DB.prepare("SELECT inscription_id, amount_cents, paid_on, created_at FROM payment_entries WHERE organization_id = ? AND kind = 'versement'").bind(organizationId).all().catch(() => ({ results: [] })),
  ]);
  return { fiches: fiches.results, known: known.results, entries: entries.results };
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const url = new URL(request.url);
  let message = '';
  if (url.searchParams.has('ok')) {
    const n = (k) => Number.parseInt(url.searchParams.get(k) || '0', 10) || 0;
    const parts = [
      n('ajoutes') && `${n('ajoutes')} versement${n('ajoutes') > 1 ? 's' : ''} ajouté${n('ajoutes') > 1 ? 's' : ''}`,
      n('lies') && `${n('lies')} déjà saisi${n('lies') > 1 ? 's' : ''}`,
      n('ecartes') && `${n('ecartes')} écarté${n('ecartes') > 1 ? 's' : ''}`,
      n('remis') && `${n('remis')} remis à décider`,
    ].filter(Boolean);
    message = flash('ok', parts.length ? `Enregistré : ${parts.join(', ')}.` : 'Aucun changement.');
    const errors = url.searchParams.getAll('erreur').slice(0, 20);
    if (errors.length) message += flash('error', `Non appliqué : ${errors.join(' ; ')}`);
  }
  return html(page(TITLE, uploadForm(message), await adminBadges(env, admin)));
}

export async function onRequestPost({ request, env, waitUntil }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const badges = await adminBadges(env, admin);
  const form = await request.formData();
  await ensureSchema(env.DB);
  const { organizationId } = admin;

  if (String(form.get('action') || '') === 'apply') {
    const lines = sanitizeLines(form.get('lignes'));
    const processed = sanitizeLines(form.get('traites'));
    if (!lines || !processed) return html(page(TITLE, uploadForm(flash('error', 'Récapitulatif invalide : déposez de nouveau le fichier.')), badges), 400);
    const { prix } = await getCategoriesConfig(env, organizationId);
    await ensureHelloAssoPaymentsTable(env.DB);
    const counts = { ajoutes: 0, lies: 0, ecartes: 0, remis: 0 };
    const errors = [];
    const touched = new Map();
    const fiche = (id) => env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
    // Du plus ancien au plus récent : l'historique et la date du dernier paiement se lisent dans l'ordre.
    const ordered = lines.map((l, i) => ({ ...l, choice: parseChoice(form.get(`choix-${i}`)) })).sort((a, b) => a.date.localeCompare(b.date));
    for (const line of ordered) {
      const { action, id } = line.choice;
      if (action === 'ignore') {
        const r = await markStatement(env.DB, organizationId, line, 'ignored').run();
        counts.ecartes += r.meta.changes;
      } else if (action === 'link') {
        if (!(await fiche(id))) errors.push(`${formatEuros(line.cents)} du ${formatBirth(line.date)} : fiche introuvable`);
        else counts.lies += (await markStatement(env.DB, organizationId, line, 'linked', id).run()).meta.changes;
      } else if (action === 'add') {
        const row = await fiche(id);
        const result = await applyPayment(env, organizationId, line, row, prix);
        if (!result.ok) {
          errors.push(`${formatEuros(line.cents)} du ${formatBirth(line.date)}${row ? ` (${fichLabel(row)})` : ''} : ${result.reason}`);
          continue;
        }
        counts.ajoutes += 1;
        if (!touched.has(id)) touched.set(id, row);
      }
    }
    for (const [i, line] of processed.entries()) {
      if (form.get(`reset-${i}`) === '1') counts.remis += (await resetStatement(env.DB, organizationId, line.ref).run()).meta.changes;
    }
    const siteUrl = new URL(request.url).origin;
    for (const [id, before] of touched) {
      // Premier paiement de la fiche : même suite que « Marquer payé » (e-mail de suivi, « Dossier complet »).
      // Un paiement déjà commencé ne change ni l'étape paiement ni « complet » (hasPaymentStarted) : rien à envoyer.
      if (!hasPaymentStarted(before)) waitUntil(afterInscriptionChange(env, { organizationId, id, before, step: 'paiement', source: 'admin', siteUrl }));
      waitUntil(syncInscriptionSafe(env, organizationId, id));
    }
    const qs = new URLSearchParams({ ok: '1', ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, String(v)])) });
    for (const e of errors.slice(0, 20)) qs.append('erreur', e);
    return new Response('', { status: 303, headers: { Location: `/admin/helloasso?${qs}` } });
  }

  const file = form.get('fichier');
  const retry = (message) => html(page(TITLE, uploadForm(flash('error', message)), badges), 400);
  if (!file || typeof file === 'string' || !file.size) return retry('Choisissez le fichier exporté de HelloAsso.');
  if (file.size > MAX_FILE_BYTES) return retry('Fichier trop volumineux (2 Mo au plus).');
  try {
    const { records, invalid } = helloAssoRecords(await readXlsxRows(new Uint8Array(await file.arrayBuffer()), { hint: 'exportez-le depuis HelloAsso au format Excel.' }));
    const { fiches, known, entries } = await loadContext(env, organizationId);
    const plan = planHelloAssoImport(records, fiches, known, entries);
    return html(page('Vérifier les paiements HelloAsso', previewBody(plan, fiches, invalid), badges));
  } catch (error) {
    if (error instanceof XlsxFileError) return retry(error.message);
    throw error;
  }
}
