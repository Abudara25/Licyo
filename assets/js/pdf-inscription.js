// Génération du PDF de fiche d'inscription — partagé entre inscription.js (généré par la famille
// à la soumission du formulaire) et functions/admin/inscriptions.js (regénéré par un responsable
// du club, ex. si la famille n'a pas reçu le mail de confirmation et souhaite le renvoyer). Script
// classique (pas de module), les fonctions sont globales comme le reste de assets/js/*.js.
// Dépend de window.jspdf (cdnjs.cloudflare.com/ajax/libs/jspdf) : balise <script> sur la fiche admin,
// chargement à la demande via loadJsPdf() sur les formulaires publics.

// jsPDF pèse lourd : le charger d'emblée sur inscription.html bloquait le navigateur pendant que la
// famille commençait à remplir le formulaire (INP de 560 ms relevé par Cloudflare Web Analytics sur
// le champ « Nom de l'enfant »). Il n'est donc chargé qu'au moment de générer le PDF.
const JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js';
const JSPDF_INTEGRITY = 'sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==';
let jsPdfLoading = null;

function loadJsPdf() {
  if (window.jspdf) return Promise.resolve();
  if (!jsPdfLoading) {
    jsPdfLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = JSPDF_SRC;
      script.integrity = JSPDF_INTEGRITY;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.onload = () => resolve();
      script.onerror = () => {
        jsPdfLoading = null;
        reject(new Error('jsPDF indisponible'));
      };
      document.head.appendChild(script);
    });
  }
  return jsPdfLoading;
}

function buildInscriptionPdfDoc(data, depotUrl) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  // data.saison vient de /api/categories (voir inscription.js) ou du champ "saison" stocké en D1
  // sur la fiche régénérée depuis /admin/inscriptions (functions/admin/inscriptions.js) — repli sur
  // la saison actuelle si absent (appel depuis un contexte qui n'a pas encore cette info).
  const saison = data.saison || '2026-2027';
  // Pas de tarif connu : aucune somme n'est imprimée (jamais un montant par défaut).
  const prix = Number.isFinite(data.prix) ? data.prix : null;

  doc.setFillColor(58, 15, 16);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(244, 182, 88);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Club Démo', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`Fiche d'inscription — Saison ${saison}`, 14, 25);

  let y = 42;
  doc.setTextColor(30, 30, 30);

  const heading = (text) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(text, 14, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
  };
  const line = (text) => {
    doc.text(text, 14, y);
    y += 6;
  };

  heading('Enfant');
  line(`Nom : ${data.enfantNom}`);
  line(`Prénom : ${data.enfantPrenom}`);
  // Lieu de naissance sur la même ligne que la date : aucune ligne ajoutée, la mise en page ne bouge pas.
  const villeNaissance = [data.cpNaissance, data.villeNaissance].filter(Boolean).join(' ');
  const lieuNaissance = [villeNaissance, data.paysNaissance].filter(Boolean).join(', ');
  line(`Date de naissance : ${data.naissance || '—'}  ·  Lieu : ${lieuNaissance || '—'}`);
  line(`Catégorie : ${data.categorie}`);
  if (data.tailleMaillot) line(`Taille de maillot : ${data.tailleMaillot}`);
  for (const f of data.customFieldList || []) line(`${f.label} : ${f.value}`);
  y += 4;

  heading('Parent / responsable légal');
  line(`Nom : ${data.parentNom}`);
  line(`Prénom : ${data.parentPrenom}`);
  line(`E-mail : ${data.email}`);
  line(`Téléphone : ${data.telephone || '—'}`);
  line(`Adresse : ${data.adresse || '—'}, ${data.codePostal || ''} ${data.ville || ''}`.trim());
  if (data.parent2Prenom || data.parent2Nom) {
    line(`2e responsable légal : ${data.parent2Prenom || ''} ${data.parent2Nom || ''}`.trim());
    line(`E-mail : ${data.parent2Email || '—'}  ·  Téléphone : ${data.parent2Telephone || '—'}`);
  }
  y += 4;

  heading('Offre choisie');
  line(prix === null ? `Adhésion saison ${saison}` : `Adhésion saison ${saison} — ${prix} €`);
  if (data.passSportCode) {
    line(prix === null ? `Pass'Sport : ${data.passSportCode} — 50 € déduits` : `Pass'Sport : ${data.passSportCode} — 50 € déduits, soit ${Math.max(0, prix - 50)} € à régler`);
  }
  line('Licence + tenue complète Sportéquip (maillot, short, survêtement, sac)');
  line(`Mode de paiement : ${data.modePaiement || '—'}`);
  y += 4;

  heading('Autorisations');
  line("J'autorise mon enfant à participer aux entraînements et activités du Club Démo.");
  line(`Droit à l'image (photos/vidéos du club) : ${data.droitImage ? 'Oui' : 'Non'}`);
  y += 8;

  doc.text('Fait à _______________________, le _______________', 14, y);
  y += 10;
  doc.text('Signature du responsable légal :', 14, y);
  y += 20;
  doc.line(14, y, 90, y);
  y += 14;

  if (depotUrl) {
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    // Le PDF est durable (papier, pièce jointe) : il pointe vers /espace-famille, jamais vers un lien personnel,
    // qui expire (functions/_shared/family-links.js). La famille y reçoit son lien par e-mail.
    doc.text('Suivez l\'inscription et déposez ce dossier signé et la photo dans votre espace famille :', 14, y);
    y += 6;
    doc.setTextColor(58, 15, 16);
    doc.textWithLink(depotUrl, 14, y, { url: depotUrl });
    y += 4;
  }

  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(
    depotUrl
      ? 'Vous pouvez aussi apporter ce dossier signé directement au club (premier entraînement). Adhésion à régler sur HelloAsso, ou en espèces/chèque en apportant ce dossier.'
      : "À apporter signé au club (premier entraînement) ou à envoyer à contact@clubdemo.licyo.fr. Adhésion à régler sur HelloAsso, ou en espèces/chèque en apportant ce dossier.",
    14,
    285
  );

  return doc;
}

function inscriptionPdfFilename(data) {
  return `inscription-${data.enfantPrenom}-${data.enfantNom}.pdf`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-');
}

function downloadInscriptionPdf(data, depotUrl) {
  const doc = buildInscriptionPdfDoc(data, depotUrl);
  doc.save(inscriptionPdfFilename(data));
}

