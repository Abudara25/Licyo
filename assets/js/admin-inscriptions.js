// Pages /admin/inscriptions, /admin/inscriptions/<id> et /admin/reinscription : ce fichier externe
// existe parce que le CSP site-wide (_headers, script-src sans 'unsafe-inline') bloque les attributs
// onchange/onsubmit et les <script> inline. La confirmation des formulaires .admin-confirm-form est
// gérée par assets/js/admin-nav.js, chargé sur les mêmes pages.

// Menu « Filtres » de la liste : chaque changement de liste déroulante applique le filtre.
document.querySelectorAll('.insc-filters select').forEach((select) => {
  select.addEventListener('change', () => select.form.submit());
});

// Bouton « Télécharger le PDF » de la fiche : régénère côté client le PDF d'inscription
// (assets/js/pdf-inscription.js, jsPDF chargé juste avant sur la fiche).
document.querySelectorAll('.adm-pdf-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    downloadInscriptionPdf(JSON.parse(btn.dataset.pdf), btn.dataset.depotUrl || null);
  });
});

// Sélection multiple (case à cocher par carte/ligne) + barre d'actions groupées (#bulk-form). Les
// cases ne sont pas dans #bulk-form (une carte contient déjà ses propres <form>, et imbriquer des
// <form> est invalide en HTML) : #bulk-form reçoit, juste avant l'envoi, un
// <input type="hidden" name="ids"> par case cochée.
const bulkForm = document.getElementById('bulk-form');
if (bulkForm) {
  const selectAllCb = document.getElementById('bulk-select-all');
  const countEl = document.getElementById('bulk-count');
  const idsContainer = document.getElementById('bulk-ids-container');
  const actionBtns = [...bulkForm.querySelectorAll('[data-bulk-action]')];
  // :not(:disabled) : /admin/reinscription désactive la case des familles déjà réinscrites (rien à
  // sélectionner pour elles) — sans ce filtre, "Tout sélectionner" les cocherait quand même via JS
  // (disabled empêche seulement le clic manuel, pas une affectation programmatique de .checked).
  const selectCheckboxes = () => [...document.querySelectorAll('.insc-select:not(:disabled)')];

  function syncBulkUI() {
    const all = selectCheckboxes();
    const checked = all.filter((cb) => cb.checked);
    countEl.textContent = `${checked.length} sélectionné(s)`;
    idsContainer.innerHTML = checked.map((cb) => `<input type="hidden" name="ids" value="${cb.dataset.id}">`).join('');
    actionBtns.forEach((btn) => {
      btn.disabled = checked.length === 0;
    });
    selectAllCb.checked = all.length > 0 && checked.length === all.length;
  }

  selectCheckboxes().forEach((cb) => cb.addEventListener('change', syncBulkUI));

  selectAllCb.addEventListener('change', () => {
    selectCheckboxes().forEach((cb) => {
      cb.checked = selectAllCb.checked;
    });
    syncBulkUI();
  });

  actionBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      // Mise à la corbeille : motif obligatoire, précision obligatoire pour « Autre » (revérifié côté serveur).
      if (btn.dataset.bulkAction === 'bulk-archive') {
        const motif = bulkForm.querySelector('input[name="archiveMotif"]:checked');
        const precision = bulkForm.querySelector('textarea[name="archiveCommentaire"]');
        if (!motif) {
          bulkForm.querySelector('input[name="archiveMotif"]').reportValidity();
          return;
        }
        if (motif.value === 'autre' && !precision.value.trim()) {
          precision.setCustomValidity('Précisez le motif « Autre ».');
          precision.reportValidity();
          precision.setCustomValidity('');
          return;
        }
      }
      const message = btn.dataset.confirm;
      if (message && !confirm(message)) return;
      document.getElementById('bulk-action').value = btn.dataset.bulkAction;
      bulkForm.submit();
    });
  });
}

// Mise à la corbeille (fiche et sélection multiple) : la précision devient obligatoire pour « Autre ».
document.querySelectorAll('.adm-archive-form').forEach((form) => {
  const precision = form.querySelector('textarea[name="archiveCommentaire"]');
  form.querySelectorAll('input[name="archiveMotif"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      precision.required = radio.value === 'autre' && radio.checked;
    });
  });
});
