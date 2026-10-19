// Espace famille /depot/<token> (functions/depot/[token].js) : retéléchargement du dossier à signer,
// généré dans le navigateur par pdf-inscription.js (jsPDF chargé à la demande). Le lien
// « Retélécharger le dossier » des e-mails ajoute ?telecharger=1 pour lancer le téléchargement
// dès l'ouverture de la page ; le bouton reste là si le navigateur l'a bloqué.
(function () {
  const btn = document.querySelector('.suivi-pdf-btn');
  if (!btn) return;
  const label = btn.textContent;

  async function download() {
    btn.disabled = true;
    btn.textContent = 'Génération…';
    try {
      await loadJsPdf();
      downloadInscriptionPdf(JSON.parse(btn.dataset.pdf), btn.dataset.depotUrl || null);
    } catch {
      alert("Le dossier n'a pas pu être généré. Réessayez, ou écrivez-nous à contact@clubdemo.licyo.fr.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  btn.addEventListener('click', download);

  const url = new URL(window.location.href);
  if (url.searchParams.get('telecharger') === '1') {
    url.searchParams.delete('telecharger');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    download();
  }
})();
