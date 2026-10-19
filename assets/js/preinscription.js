// Pré-inscription (liste d'intérêt d'un groupe pas encore ouvert) : page /pre-inscription-u10, balisage écrit par
// renderer/preregistration.js. Lit l'état public (/api/preinscriptions : places restantes, ouvert ou non, années
// acceptées), contrôle le formulaire puis l'envoie en JSON. Le serveur revérifie tout (plafond, doublon, âge).
(function () {
  'use strict';

  var status = document.getElementById('preinscription-status');
  var form = document.getElementById('preinscription-form');
  if (!status || !form) return;

  var errorBox = document.getElementById('preinscription-error');
  var success = document.getElementById('preinscription-success');
  var state = null;
  var turnstile = { siteKey: '', widgetId: null };

  function showState(next) {
    state = next;
    if (!next || !next.available) return;
    var remaining = next.remaining;
    var remainingEl = document.getElementById('preinscription-remaining');
    var labelEl = document.getElementById('preinscription-remaining-label');
    var capacityEl = document.getElementById('preinscription-capacity');
    var bar = document.getElementById('preinscription-progress');
    if (remainingEl) remainingEl.textContent = String(remaining);
    if (labelEl) labelEl.textContent = remaining > 1 ? labelEl.dataset.many : labelEl.dataset.one;
    if (capacityEl) capacityEl.textContent = String(next.capacity);
    if (bar) bar.style.width = Math.min(100, Math.round((next.count / next.capacity) * 100)) + '%';
    if (!success || success.hidden) status.dataset.state = next.opened ? 'opened' : next.closed ? 'closed' : next.full ? 'full' : 'open';
  }

  function setupTurnstile(siteKey) {
    var anchor = document.getElementById('preinscription-turnstile');
    if (!siteKey || turnstile.siteKey || !anchor) return;
    turnstile.siteKey = siteKey;
    window.demoTurnstileReady = function () {
      turnstile.widgetId = window.turnstile.render(anchor, { sitekey: siteKey, language: 'fr', appearance: 'interaction-only' });
    };
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=demoTurnstileReady';
    script.async = true;
    document.head.appendChild(script);
  }

  function turnstileToken() {
    return turnstile.siteKey && window.turnstile && turnstile.widgetId !== null ? window.turnstile.getResponse(turnstile.widgetId) || '' : '';
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
    if (message) errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Âge hors du groupe : message immédiat (trop jeune / trop âgé), orienté vers la catégorie ouverte qui correspond
  // (formulaire d'inscription) ou, s'il n'y en a pas, vers la page Contact. Catégories lues sur /api/categories.
  var ageBox = document.getElementById('preinscription-age');
  var categories = [];
  fetch('/api/categories', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) { categories = (data && Array.isArray(data.categories)) ? data.categories : []; checkAge(); })
    .catch(function () {});

  function fillTemplate(text, values) {
    return text.replace(/\{(\w+)\}/g, function (all, key) { return values[key] !== undefined ? values[key] : all; });
  }

  // Renvoie true si l'année est acceptée (ou inconnue), false sinon (message affiché).
  function checkAge() {
    if (!ageBox) return true;
    var value = form.elements.naissance.value;
    var year = Number(value.slice(0, 4));
    if (!value || !year || !state || !state.available || (year >= state.anneeMin && year <= state.anneeMax)) {
      ageBox.hidden = true;
      return true;
    }
    var d = ageBox.dataset;
    var values = { annee: year, groupe: state.label };
    var category = categories.find(function (c) { return year >= c.anneeMin && year <= c.anneeMax; });
    ageBox.textContent = '';
    var p = document.createElement('p');
    p.textContent = fillTemplate(year > state.anneeMax ? d.young : d.old, values) + ' ' +
      (category ? fillTemplate(d.category, { categorie: category.label }) : d.none);
    var link = document.createElement('a');
    link.className = 'btn btn-primary';
    link.href = category ? d.inscriptionHref : d.contactHref;
    link.textContent = category ? d.inscription : d.contact;
    ageBox.append(p, link);
    ageBox.hidden = false;
    return false;
  }
  form.elements.naissance.addEventListener('change', checkAge);
  form.elements.naissance.addEventListener('input', checkAge);

  fetch('/api/preinscriptions', { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      showState(data);
      setupTurnstile(data.turnstileSiteKey);
      checkAge();
    })
    .catch(function () {});

  // Second responsable facultatif : dès qu'un de ses champs est rempli, prénom et nom deviennent requis.
  var parent2Names = ['parent2Prenom', 'parent2Nom', 'parent2Email', 'parent2Telephone'];
  function syncParent2() {
    var filled = parent2Names.some(function (n) { return form.elements[n] && form.elements[n].value.trim(); });
    if (form.elements.parent2Prenom) form.elements.parent2Prenom.required = filled;
    if (form.elements.parent2Nom) form.elements.parent2Nom.required = filled;
  }
  parent2Names.forEach(function (n) { if (form.elements[n]) form.elements[n].addEventListener('input', syncParent2); });

  function validate() {
    syncParent2();
    var invalid = Array.prototype.find.call(form.querySelectorAll('[required]'), function (el) {
      return el.type === 'checkbox' ? !el.checked : !el.value.trim() || !el.checkValidity();
    });
    if (invalid) {
      var details = invalid.closest('details');
      if (details) details.open = true;
      invalid.focus();
      return invalid.type === 'checkbox' ? 'Merci de cocher la case de consentement.' : 'Merci de remplir correctement tous les champs obligatoires.';
    }
    if (!checkAge()) {
      ageBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'age';
    }
    return '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var problem = validate();
    showError(problem === 'age' ? '' : problem);
    if (problem) return;

    var button = form.querySelector('button[type=submit]');
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Envoi…';
    var el = form.elements;
    var payload = {
      enfantPrenom: el.enfantPrenom.value,
      enfantNom: el.enfantNom.value,
      naissance: el.naissance.value,
      paysNaissance: el.paysNaissance.value,
      villeNaissance: el.villeNaissance.value,
      tailleMaillot: el.tailleMaillot ? el.tailleMaillot.value : '',
      parentPrenom: el.parentPrenom.value,
      parentNom: el.parentNom.value,
      email: el.email.value,
      telephone: el.telephone.value,
      parent2Prenom: el.parent2Prenom ? el.parent2Prenom.value : '',
      parent2Nom: el.parent2Nom ? el.parent2Nom.value : '',
      parent2Email: el.parent2Email ? el.parent2Email.value : '',
      parent2Telephone: el.parent2Telephone ? el.parent2Telephone.value : '',
      commentaire: el.commentaire.value,
      rgpd: el.rgpd.checked,
      turnstileToken: turnstileToken(),
    };

    fetch('/api/preinscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (r.ok && r.data.ok) {
          form.reset();
          form.closest('.prein-open').hidden = true;
          success.hidden = false;
          status.dataset.state = 'done';
          showState(r.data);
          success.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (r.data.full) return showState(Object.assign({}, state, { full: true, remaining: 0, count: state ? state.capacity : 0 }));
        if (r.data.opened) return showState(Object.assign({}, state, { opened: true }));
        if (r.data.closed) return showState(Object.assign({}, state, { closed: true }));
        showError(r.data.error || 'Envoi impossible pour le moment. Réessayez ou écrivez-nous.');
        if (r.data.turnstile && window.turnstile && turnstile.widgetId !== null) window.turnstile.reset(turnstile.widgetId);
      })
      .catch(function () {
        showError('Connexion impossible. Vérifiez votre réseau et réessayez.');
      })
      .then(function () {
        button.disabled = false;
        button.textContent = label;
      });
  });
})();
