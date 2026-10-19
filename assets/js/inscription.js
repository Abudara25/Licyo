// Club Démo — formulaire d'inscription (inscription.html, /reinscription/<token>) : saisie en
// 3 étapes quand le HTML les prévoit (.form-step), génération du PDF rempli, puis lien vers l'espace
// famille (/depot/<token>) et paiement HelloAsso (widget adapté à la catégorie choisie).

// Repli utilisé tant que /api/categories n'a pas répondu (ou s'il échoue) : catégories, tranches de
// naissance, saison et liens HelloAsso sont gérés depuis /admin/categories.
const FALLBACK_SAISON = '2026-2027';
const FALLBACK_PRIX = 180;
// Montant de l'aide Pass'Sport, fixé par l'État (50 € pour 2026-2027).
const PASS_SPORT_REDUCTION = 50;
const FALLBACK_HELLOASSO_URLS = {
  'U6 - U7': 'https://www.helloasso.com/beta/associations/club-demo-licyo/adhesions/adhesion-u6-u7-club-demo',
  'U8 - U9': 'https://www.helloasso.com/beta/associations/club-demo-licyo/adhesions/adhesion-u8-u9-club-demo',
};
const FALLBACK_HELLOASSO_WIDGET_URLS = {
  'U6 - U7': 'https://www.helloasso.com/associations/club-demo-licyo/adhesions/adhesion-u6-u7-club-demo/widget',
  'U8 - U9': 'https://www.helloasso.com/associations/club-demo-licyo/adhesions/adhesion-u8-u9-club-demo/widget',
};
const FALLBACK_CATEGORIE_PAR_ANNEE = { 2020: 'U6 - U7', 2021: 'U6 - U7', 2018: 'U8 - U9', 2019: 'U8 - U9' };

// Iframe du widget HelloAsso, agrandie à la hauteur que HelloAsso annonce par postMessage.
// L'AbortController retire l'écouteur du widget précédent quand un nouvel envoi en recrée un.
let helloassoMessageAbort = null;

function createHelloAssoWidget(url) {
  helloassoMessageAbort?.abort();
  helloassoMessageAbort = new AbortController();
  const { signal } = helloassoMessageAbort;

  const iframe = document.createElement('iframe');
  iframe.id = 'haWidget';
  iframe.allowTransparency = 'true';
  iframe.scrolling = 'auto';
  iframe.src = url;
  iframe.style.width = '100%';
  iframe.style.height = '750px';
  iframe.style.border = 'none';
  iframe.addEventListener(
    'load',
    () => {
      window.addEventListener(
        'message',
        (e) => {
          if (e.origin !== 'https://www.helloasso.com') return;
          const dataHeight = e.data?.height;
          if (dataHeight > parseFloat(iframe.style.height || 0)) {
            iframe.style.height = `${dataHeight}px`;
          }
        },
        { signal }
      );
    },
    { signal }
  );
  return iframe;
}

// Cloudflare Turnstile : chargé seulement si /api/categories fournit une clé publique (secret
// TURNSTILE_SITE_KEY du projet Pages). Mode "interaction-only" : invisible sauf en cas de doute.
const turnstile = { siteKey: '', widgetId: null };

function setupTurnstile(siteKey, anchor) {
  if (!siteKey || turnstile.siteKey || !anchor) return;
  turnstile.siteKey = siteKey;
  const container = document.createElement('div');
  container.className = 'form-turnstile';
  anchor.before(container);
  window.demoTurnstileReady = () => {
    turnstile.widgetId = window.turnstile.render(container, { sitekey: siteKey, language: 'fr', appearance: 'interaction-only' });
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=demoTurnstileReady';
  script.async = true;
  document.head.appendChild(script);
}

const turnstileToken = () =>
  turnstile.siteKey && window.turnstile && turnstile.widgetId !== null ? window.turnstile.getResponse(turnstile.widgetId) || '' : '';

const resetTurnstile = () => {
  if (window.turnstile && turnstile.widgetId !== null) window.turnstile.reset(turnstile.widgetId);
};

document.addEventListener('DOMContentLoaded', () => {
  const statusEl = document.getElementById('inscription-status');
  if (statusEl) {
    fetch('/api/inscription-status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || (data.status !== 'open' && data.status !== 'closed')) return;
        // "priority" : fermé au public, mais la réinscription prioritaire est encore en cours.
        if (data.status === 'closed' && data.dateLimiteReinscription) {
          statusEl.dataset.status = 'priority';
          const dateEl = document.getElementById('inscription-priority-date');
          if (dateEl) {
            try {
              dateEl.textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(`${data.dateLimiteReinscription}T00:00:00`));
            } catch {
              dateEl.textContent = data.dateLimiteReinscription;
            }
          }
        } else {
          statusEl.dataset.status = data.status;
        }
      })
      .catch(() => {}); // en cas d'échec, on garde le data-status par défaut ("open")
  }

  const form = document.getElementById('inscription-form');
  if (!form) return;

  const nextSteps = document.getElementById('inscription-next-steps');
  const depotBtn = document.getElementById('depot-btn');
  const depotFallback = document.getElementById('depot-fallback');
  const depotEmailHint = document.getElementById('depot-email-hint');
  const mailtoBtn = document.getElementById('mailto-btn');
  const especesChequeBox = document.getElementById('paiement-especes-cheque');
  const especesChequeMode = document.getElementById('paiement-especes-cheque-mode');
  const especesChequePassSport = document.getElementById('paiement-especes-cheque-passsport');
  const passSportPaiementNote = document.getElementById('paiement-passsport');
  const passSportPaiementCode = document.getElementById('paiement-passsport-code');
  const helloassoBox = document.getElementById('paiement-helloasso');
  const helloassoWidgetContainer = document.getElementById('helloasso-widget-container');
  const helloassoFallbackLink = document.getElementById('helloasso-fallback-link');
  const submitBtn = form.querySelector('button[type=submit]');
  const submitBtnDefaultLabel = submitBtn.textContent;
  // Turnstile et messages d'erreur se placent juste au-dessus des boutons d'envoi.
  const submitAnchor = submitBtn.closest('.form-step-nav') || submitBtn;

  // État rempli par /api/categories (let : les gestionnaires lisent la valeur à jour).
  let saison = FALLBACK_SAISON;
  let prix = FALLBACK_PRIX;
  let categorieParAnnee = FALLBACK_CATEGORIE_PAR_ANNEE;
  let helloAssoUrls = FALLBACK_HELLOASSO_URLS;
  let helloAssoWidgetUrls = FALLBACK_HELLOASSO_WIDGET_URLS;
  let firstCategorieAvecHelloAsso = Object.keys(FALLBACK_HELLOASSO_WIDGET_URLS)[0];

  // Pass'Sport : la note (montant déduit) n'apparaît que si la famille saisit un code.
  const passSportInput = form.passSportCode;
  const passSportNote = document.getElementById('pass-sport-note');
  if (passSportInput && passSportNote) {
    const syncPassSportNote = () => {
      passSportNote.hidden = !passSportInput.value.trim();
    };
    passSportInput.addEventListener('input', syncPassSportNote);
    syncPassSportNote();
  }

  const naissanceInput = form.naissance;
  const categorieSelect = form.categorie;

  fetch('/api/categories')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.turnstileSiteKey) setupTurnstile(data.turnstileSiteKey, submitAnchor);
      if (!data || !Array.isArray(data.categories) || !data.categories.length) return;

      if (data.saison) {
        saison = data.saison;
        document.querySelectorAll('[data-saison-text]').forEach((el) => {
          el.textContent = saison;
        });
      }
      if (data.prix === null) {
        // Tarif non renseigné pour cette organisation : aucun montant affiché ni imprimé.
        prix = null;
        document.querySelectorAll('[data-prix-block]').forEach((el) => {
          el.hidden = true;
        });
      } else if (Number.isFinite(data.prix)) {
        prix = data.prix;
        document.querySelectorAll('[data-prix-text]').forEach((el) => {
          el.textContent = prix;
        });
        // Aperçu du montant par échéance : le vrai plan de paiement est réglé chez HelloAsso.
        document.querySelectorAll('[data-prix-tiers-text]').forEach((el) => {
          el.textContent = Math.round(prix / 3);
        });
        // Montant restant avec le Pass'Sport (aide de l'État de 50 €, déduite par le club).
        document.querySelectorAll('[data-prix-passsport-text]').forEach((el) => {
          el.textContent = Math.max(0, prix - PASS_SPORT_REDUCTION);
        });
      }

      categorieParAnnee = {};
      helloAssoUrls = {};
      helloAssoWidgetUrls = {};
      firstCategorieAvecHelloAsso = null;

      for (const c of data.categories) {
        for (let annee = c.anneeMin; annee <= c.anneeMax; annee++) categorieParAnnee[annee] = c.label;
        if (c.helloAssoUrl) helloAssoUrls[c.label] = c.helloAssoUrl;
        if (c.helloAssoWidgetUrl) helloAssoWidgetUrls[c.label] = c.helloAssoWidgetUrl;
        if (!firstCategorieAvecHelloAsso && c.helloAssoWidgetUrl) firstCategorieAvecHelloAsso = c.label;
      }
      if (!firstCategorieAvecHelloAsso) firstCategorieAvecHelloAsso = data.categories[0].label;

      if (categorieSelect) {
        const previousValue = categorieSelect.value;
        // Options créées via le DOM : aucune donnée de l'API n'est interprétée comme du HTML.
        categorieSelect.replaceChildren(
          ...data.categories.map((c) => {
            const annees = c.anneeMin === c.anneeMax ? c.anneeMin : `${c.anneeMin}-${c.anneeMax}`;
            return new Option(`${c.label} (${annees})`, c.label);
          })
        );
        // Date déjà renseignée (réinscription pré-remplie, ou saisie avant la réponse) : catégorie
        // recalculée avec les tranches à jour ; sinon, sélection précédente conservée si elle existe.
        const anneeNaissance = naissanceInput?.value ? new Date(naissanceInput.value).getUTCFullYear() : null;
        const categorieRecalculee = anneeNaissance && categorieParAnnee[anneeNaissance];
        if (categorieRecalculee) {
          categorieSelect.value = categorieRecalculee;
        } else if (data.categories.some((c) => c.label === previousValue)) {
          categorieSelect.value = previousValue;
        }
      }
    })
    .catch(() => {}); // en cas d'échec, on garde les repères par défaut (FALLBACK_*)

  const ageWarning = document.getElementById('inscription-age-warning');

  // Vrai seulement si l'année de naissance tombe dans la tranche de la catégorie sélectionnée.
  function naissanceCorrespondACategorie() {
    if (!naissanceInput.value) return false;
    const annee = new Date(naissanceInput.value).getUTCFullYear();
    return categorieParAnnee[annee] === categorieSelect.value;
  }

  if (naissanceInput && categorieSelect) {
    naissanceInput.addEventListener('change', () => {
      // getUTCFullYear : "YYYY-MM-DD" est lu comme minuit UTC (un fuseau négatif décalerait l'année).
      const annee = new Date(naissanceInput.value).getUTCFullYear();
      const categorie = categorieParAnnee[annee];
      if (categorie) {
        categorieSelect.value = categorie;
        if (ageWarning) ageWarning.hidden = true;
      } else if (ageWarning) {
        ageWarning.hidden = false;
      }
    });
  }

  // ---------- Étapes ----------
  const steps = [...form.querySelectorAll('.form-step')];
  const stepsIndicator = document.getElementById('form-steps');
  let currentStep = 0;

  function showStep(index, { scroll = true } = {}) {
    currentStep = index;
    steps.forEach((step, i) => {
      step.hidden = i !== index;
    });
    stepsIndicator?.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('is-current', i === index);
      li.classList.toggle('is-done', i < index);
      if (i === index) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    if (scroll) {
      (stepsIndicator || form).scrollIntoView({ behavior: 'smooth', block: 'start' });
      steps[index].querySelector('input, select')?.focus({ preventScroll: true });
    }
  }

  // Signale un champ invalide en affichant d'abord l'étape et le bloc repliable qui le contiennent.
  function reportField(field) {
    const stepIndex = steps.findIndex((step) => step.contains(field));
    if (stepIndex !== -1 && stepIndex !== currentStep) showStep(stepIndex, { scroll: false });
    field.closest('details')?.setAttribute('open', '');
    field.reportValidity();
  }

  function validate(container) {
    const invalid = [...container.querySelectorAll('input, select, textarea')].find((field) => !field.checkValidity());
    if (invalid) {
      reportField(invalid);
      return false;
    }
    if (naissanceInput && container.contains(naissanceInput) && !naissanceCorrespondACategorie()) {
      const stepIndex = steps.findIndex((step) => step.contains(naissanceInput));
      if (stepIndex !== -1 && stepIndex !== currentStep) showStep(stepIndex, { scroll: false });
      if (ageWarning) {
        ageWarning.hidden = false;
        ageWarning.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return false;
    }
    return true;
  }

  if (steps.length) {
    form.classList.add('is-stepped');
    if (stepsIndicator) stepsIndicator.hidden = false;
    showStep(0, { scroll: false });
    form.addEventListener('click', (e) => {
      if (e.target.closest('[data-step-next]')) {
        if (validate(steps[currentStep])) showStep(Math.min(currentStep + 1, steps.length - 1));
      } else if (e.target.closest('[data-step-prev]')) {
        showStep(Math.max(currentStep - 1, 0));
      }
    });
  }

  // ---------- Avertissements ----------
  // Avertissement précoce de doublon, dès que prénom, nom et e-mail sont remplis (le contrôle
  // définitif reste celui du serveur à l'envoi).
  const duplicateWarning = document.getElementById('inscription-duplicate-warning');
  let duplicateCheckController = null;

  async function checkDuplicateInline() {
    const enfantPrenom = form.enfantPrenom.value.trim();
    const enfantNom = form.enfantNom.value.trim();
    const email = form.email.value.trim();
    if (!duplicateWarning || !enfantPrenom || !enfantNom || !email) {
      if (duplicateWarning) duplicateWarning.hidden = true;
      return;
    }

    duplicateCheckController?.abort();
    duplicateCheckController = new AbortController();
    try {
      const params = new URLSearchParams({ enfantPrenom, enfantNom, email });
      if (form.naissance.value) params.set('naissance', form.naissance.value);
      const res = await fetch(`/api/inscriptions?${params}`, { signal: duplicateCheckController.signal });
      const json = res.ok ? await res.json() : null;
      duplicateWarning.hidden = !json?.duplicate;
    } catch {
      // requête abandonnée ou réseau indisponible : pas de fausse alerte
    }
  }

  [form.enfantPrenom, form.enfantNom, form.email].forEach((el) => el.addEventListener('blur', checkDuplicateInline));

  // Second responsable légal facultatif : dès qu'un de ses champs est rempli, prénom et nom deviennent requis.
  const parent2Fields = ['parent2Prenom', 'parent2Nom', 'parent2Email', 'parent2Telephone'].map((name) => form[name]).filter(Boolean);
  const syncParent2Required = () => {
    const filled = parent2Fields.some((input) => input.value.trim());
    if (form.parent2Prenom) form.parent2Prenom.required = filled;
    if (form.parent2Nom) form.parent2Nom.required = filled;
  };
  parent2Fields.forEach((input) => input.addEventListener('input', syncParent2Required));
  syncParent2Required();

  let submitError = null;
  function showSubmitError(message) {
    if (!submitError) {
      submitError = document.createElement('p');
      submitError.className = 'form-alert';
      submitError.setAttribute('role', 'alert');
      submitAnchor.before(submitError);
    }
    submitError.textContent = message;
    submitError.hidden = !message;
  }

  // ---------- Envoi ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Entrée pressée dans un champ d'une étape intermédiaire : on passe à l'étape suivante.
    if (steps.length && currentStep < steps.length - 1) {
      if (validate(steps[currentStep])) showStep(currentStep + 1);
      return;
    }
    if (!validate(form)) return;
    if (turnstile.siteKey && !turnstileToken()) {
      showSubmitError('Vérification anti-robot en cours… patientez une seconde, puis renvoyez le formulaire.');
      return;
    }
    showSubmitError('');

    const data = {
      enfantPrenom: form.enfantPrenom.value.trim(),
      enfantNom: form.enfantNom.value.trim(),
      naissance: form.naissance.value,
      villeNaissance: form.villeNaissance?.value.trim() || '',
      paysNaissance: form.paysNaissance?.value.trim() || '',
      cpNaissance: form.cpNaissance?.value.trim() || '',
      categorie: form.categorie.value,
      saison,
      prix,
      tailleMaillot: form.tailleMaillot ? form.tailleMaillot.value : '',
      modePaiement: form.modePaiement.value,
      parentPrenom: form.parentPrenom.value.trim(),
      parentNom: form.parentNom.value.trim(),
      email: form.email.value.trim(),
      telephone: form.telephone.value.trim(),
      parent2Prenom: form.parent2Prenom?.value.trim() || '',
      parent2Nom: form.parent2Nom?.value.trim() || '',
      parent2Email: form.parent2Email?.value.trim() || '',
      parent2Telephone: form.parent2Telephone?.value.trim() || '',
      adresse: form.adresse.value.trim(),
      codePostal: form.codePostal.value.trim(),
      ville: form.ville.value.trim(),
      passSportCode: form.passSportCode?.value.trim() || '',
      autorisation: form.autorisation.checked,
      droitImage: form.droitImage.checked,
      rgpd: form.rgpd.checked,
    };

    // Bouton mis à jour avant tout travail ; jsPDF n'est chargé qu'ici (loadJsPdf, pdf-inscription.js).
    submitBtn.disabled = true;
    submitBtn.textContent = 'Génération…';
    try {
      await loadJsPdf();
    } catch {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtnDefaultLabel;
      showSubmitError("Le générateur de PDF n'a pas pu se charger (connexion instable ou bloqueur de contenu). Réessayez, ou écrivez-nous à contact@clubdemo.licyo.fr.");
      return;
    }

    // Réponse attendue avant de télécharger le PDF : le lien de l'espace famille y est imprimé.
    let uploadToken = null;
    let duplicate = false;
    let refusal = null;
    try {
      const res = await fetch('/api/inscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Jeton du lien personnel de réinscription (seulement sur /reinscription/<token>) : accepté même quand les
        // inscriptions publiques sont fermées (vérifié par functions/api/inscriptions.js).
        body: JSON.stringify({ ...data, reinscriptionToken: form.reinscriptionToken?.value || '', turnstileToken: turnstileToken() }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.duplicate) duplicate = true;
      else if (res.ok) uploadToken = json?.uploadToken || null;
      else if (res.status === 429 || res.status === 403) refusal = json?.error || 'Envoi refusé pour le moment, réessayez plus tard.';
    } catch {
      // uploadToken reste null : repli sur l'envoi du dossier par e-mail ci-dessous.
    }
    resetTurnstile();
    submitBtn.disabled = false;
    submitBtn.textContent = submitBtnDefaultLabel;

    if (refusal) {
      showSubmitError(refusal);
      return;
    }

    const duplicateEl = document.getElementById('inscription-duplicate');
    // Doublon : pas de nouveau PDF ni de nouvelles étapes, le lien est renvoyé par e-mail par le serveur.
    if (duplicate) {
      if (duplicateEl) {
        duplicateEl.hidden = false;
        duplicateEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    if (duplicateEl) duplicateEl.hidden = true;

    downloadInscriptionPdf(data, `${location.origin}/espace-famille`);

    if (uploadToken) {
      depotBtn.href = `/depot/${uploadToken}`;
      depotBtn.hidden = false;
      depotFallback.hidden = true;
      if (depotEmailHint) depotEmailHint.hidden = false;
    } else {
      depotBtn.hidden = true;
      depotFallback.hidden = false;
      // Sans lien, aucun e-mail n'est parti : ne pas l'annoncer.
      if (depotEmailHint) depotEmailHint.hidden = true;
      const subject = `Inscription ${data.enfantPrenom} ${data.enfantNom} — Club Démo`;
      const body = [
        'Bonjour,',
        '',
        `Veuillez trouver en pièce jointe la fiche d'inscription de ${data.enfantPrenom} ${data.enfantNom} (${data.categorie}).`,
        "Merci de joindre le PDF que vous venez de télécharger avant l'envoi de cet e-mail.",
        '',
        'Cordialement,',
        `${data.parentPrenom} ${data.parentNom}`,
      ].join('\n');
      mailtoBtn.href = `mailto:contact@clubdemo.licyo.fr?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }

    // Rappel du code Pass'Sport à l'étape du paiement : c'est là que la famille en a besoin.
    if (passSportPaiementNote && passSportPaiementCode) {
      passSportPaiementCode.textContent = data.passSportCode;
      passSportPaiementNote.hidden = !data.passSportCode;
    }
    if (especesChequePassSport) especesChequePassSport.hidden = !data.passSportCode;

    if (data.modePaiement === 'HelloAsso') {
      const widgetUrl = helloAssoWidgetUrls[data.categorie] || helloAssoWidgetUrls[firstCategorieAvecHelloAsso];
      helloassoWidgetContainer.replaceChildren(createHelloAssoWidget(widgetUrl));
      helloassoFallbackLink.href = helloAssoUrls[data.categorie] || helloAssoUrls[firstCategorieAvecHelloAsso];
      helloassoBox.hidden = false;
      especesChequeBox.hidden = true;
    } else {
      helloassoBox.hidden = true;
      helloassoWidgetContainer.replaceChildren();
      especesChequeMode.textContent = data.modePaiement || 'espèces ou chèque';
      especesChequeBox.hidden = false;
    }

    nextSteps.hidden = false;
    nextSteps.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
