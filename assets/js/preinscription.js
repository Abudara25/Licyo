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

  // Plusieurs groupes (2026-11-04) : `groups` (état de chaque groupe) ; le groupe est celui de l'année de naissance
  // saisie. Le formulaire reste visible tant qu'un groupe est ouvert ; un groupe complet, fermé ou déjà ouvert est
  // signalé sous la date. Ancienne réponse (un seul groupe, sans `groups`) : traitée comme une liste d'un groupe.
  var groups = [];

  function groupOf(year) {
    return groups.find(function (g) { return year >= g.anneeMin && year <= g.anneeMax; }) || null;
  }

  function selectedYear() {
    var value = form.elements.naissance.value;
    return value ? Number(value.slice(0, 4)) : 0;
  }

  function yearsText(g) {
    return g.anneeMin === g.anneeMax ? 'nés en ' + g.anneeMin : 'nés de ' + g.anneeMin + ' à ' + g.anneeMax;
  }

  function renderGroups(current) {
    var list = document.getElementById('preinscription-groups');
    if (!list) return;
    list.textContent = '';
    groups.forEach(function (g) {
      var li = document.createElement('li');
      if (current && g.groupe === current.groupe) li.className = 'is-current';
      var name = document.createElement('strong');
      name.textContent = g.label;
      var years = document.createElement('span');
      years.textContent = yearsText(g);
      var places = document.createElement('span');
      places.textContent = g.opened ? 'ouvert : inscription' : g.closed ? 'fermé' : g.full ? 'complet' : g.remaining + ' / ' + g.capacity + ' places';
      li.append(name, years, places);
      list.appendChild(li);
    });
    list.hidden = groups.length === 0;
  }

  // Récapitulatif : le groupe de l'année saisie, sinon le total des groupes ouverts.
  function showSummary() {
    var current = groupOf(selectedYear());
    var open = groups.filter(function (g) { return g.open; });
    var pool = current ? [current] : open.length ? open : groups;
    var remaining = pool.reduce(function (n, g) { return n + g.remaining; }, 0);
    var capacity = pool.reduce(function (n, g) { return n + g.capacity; }, 0);
    var count = pool.reduce(function (n, g) { return n + g.count; }, 0);
    var remainingEl = document.getElementById('preinscription-remaining');
    var labelEl = document.getElementById('preinscription-remaining-label');
    var capacityEl = document.getElementById('preinscription-capacity');
    var bar = document.getElementById('preinscription-progress');
    if (remainingEl) remainingEl.textContent = String(remaining);
    if (labelEl) labelEl.textContent = remaining > 1 ? labelEl.dataset.many : labelEl.dataset.one;
    if (capacityEl) capacityEl.textContent = String(capacity);
    if (bar) bar.style.width = (capacity ? Math.min(100, Math.round((count / capacity) * 100)) : 0) + '%';
    renderGroups(current);
  }

  function showState(next) {
    state = next;
    if (!next || !next.available) return;
    groups = Array.isArray(next.groups) && next.groups.length ? next.groups : [next];
    showSummary();
    // Bloc affiché : le formulaire si au moins un groupe est ouvert, sinon l'état du premier groupe.
    var anyOpen = groups.some(function (g) { return g.open; });
    var first = groups[0];
    if (!success || success.hidden) status.dataset.state = anyOpen ? 'open' : first.opened ? 'opened' : first.closed ? 'closed' : first.full ? 'full' : 'open';
  }

  // Mise à jour d'un seul groupe après une réponse du serveur (complet, fermé, ouvert entre-temps).
  function updateGroup(key, changes) {
    groups = groups.map(function (g) { return g.groupe === key ? Object.assign({}, g, changes) : g; });
    showState(Object.assign({}, state, { groups: groups }));
    checkAge();
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

  function showAgeMessage(text, href, label) {
    ageBox.textContent = '';
    var p = document.createElement('p');
    p.textContent = text;
    var link = document.createElement('a');
    link.className = 'btn btn-primary';
    link.href = href;
    link.textContent = label;
    ageBox.append(p, link);
    ageBox.hidden = false;
  }

  // Renvoie true si l'année désigne un groupe ouvert (ou si elle est inconnue), false sinon (message affiché).
  function checkAge() {
    if (!ageBox) return true;
    var year = selectedYear();
    if (state && state.available) showSummary();
    if (!year || !state || !state.available || !groups.length) {
      ageBox.hidden = true;
      return true;
    }
    var d = ageBox.dataset;
    var group = groupOf(year);
    if (group && group.open) {
      ageBox.hidden = true;
      return true;
    }
    if (group) {
      var text = fillTemplate(group.opened ? d.opened : group.closed ? d.closed : d.full, { groupe: group.label });
      if (group.opened) showAgeMessage(text, d.inscriptionHref, d.inscription);
      else showAgeMessage(text, d.contactHref, d.contact);
      return false;
    }
    var names = groups.map(function (g) { return g.label; }).join(', ');
    var young = groups.every(function (g) { return year > g.anneeMax; });
    var category = categories.find(function (c) { return year >= c.anneeMin && year <= c.anneeMax; });
    showAgeMessage(
      fillTemplate(young ? d.young : d.old, { annee: year, groupe: names }) + ' ' + (category ? fillTemplate(d.category, { categorie: category.label }) : d.none),
      category ? d.inscriptionHref : d.contactHref,
      category ? d.inscription : d.contact
    );
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
      cpNaissance: el.cpNaissance ? el.cpNaissance.value : '',
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
          var done = r.data;
          groups = groups.map(function (g) { return g.groupe === done.groupe ? Object.assign({}, g, done) : g; });
          showState(Object.assign({}, state, { groups: groups }));
          success.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        var key = r.data.groupe || (groupOf(selectedYear()) || {}).groupe;
        if (key && r.data.full) return updateGroup(key, { full: true, open: false, remaining: 0 });
        if (key && r.data.opened) return updateGroup(key, { opened: true, open: false });
        if (key && r.data.closed) return updateGroup(key, { closed: true, open: false });
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
