// Page /admin/categories (functions/admin/categories.js). La confirmation avant suppression d'une
// catégorie (.admin-confirm-form) est gérée par le handler partagé dans assets/js/admin-nav.js
// (chargé sur cette page), pas ici.

// Formulaire "Saison et tarif" : confirmation seulement si le libellé de saison change vraiment
// (pas à chaque enregistrement du tarif seul) — data-current-saison porte la valeur enregistrée
// côté serveur, comparée à la valeur tapée au moment du submit. Impact réel expliqué dans le
// message : les adhérents basculent automatiquement dans /admin/reinscription (voir
// functions/admin/categories.js) — réversible via le bouton "Revenir à la saison précédente".
const saisonForm = document.getElementById('saison-form');
const saisonInput = document.getElementById('saison');
if (saisonForm && saisonInput) {
  saisonForm.addEventListener('submit', (e) => {
    const previous = saisonInput.dataset.currentSaison;
    const next = saisonInput.value.trim();
    if (next === previous) return; // tarif seul modifié (ou aucun changement) : pas de confirmation
    const message = `Faire passer la saison de « ${previous} » à « ${next} » ? Tous les adhérents actuels de « ${previous} » basculeront automatiquement dans /admin/reinscription. C'est réversible (bouton « Revenir à la saison précédente » une fois enregistré).`;
    if (!confirm(message)) e.preventDefault();
  });
}
