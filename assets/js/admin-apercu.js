// Aperçu d'un dossier PDF dans l'admin (functions/admin/inscriptions/[id]/apercu.js) : chaque page
// est dessinée dans un <canvas> par PDF.js, pour que le document s'affiche dans l'application au lieu
// d'être confié à la visionneuse PDF du téléphone.
(async () => {
  const viewer = document.querySelector('.adm-viewer[data-pdf]');
  if (!viewer) return;
  const status = viewer.querySelector('.adm-viewer-status');
  const fail = () => {
    status.innerHTML = 'Impossible d’afficher le dossier ici. <a href="' + viewer.dataset.pdf + '?telecharger=1" download>Le télécharger</a>';
  };
  // PDF.js 5 est un module (exécuté après ce script classique) : on attend la fin du chargement.
  if (!window.pdfjsLib && document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }
  if (!window.pdfjsLib) return fail();

  // Garder la même version que le module chargé par functions/admin/inscriptions/[id]/apercu.js.
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.7.284/pdf.worker.min.mjs';
  try {
    const data = await (await fetch(viewer.dataset.pdf, { credentials: 'same-origin' })).arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
    status.remove();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const width = viewer.clientWidth;
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.setAttribute('aria-label', `Page ${n} sur ${pdf.numPages}`);
      viewer.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  } catch {
    fail();
  }
})();
