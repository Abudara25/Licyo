// Formulaire de contact (bloc contact_form du moteur) : envoi à /api/contact sans quitter la page, puis message de
// confirmation. Sans ce script, le formulaire part en envoi classique et le serveur ramène sur /contact?envoi=ok|erreur,
// lu ci-dessous. Turnstile n'est inséré que si sa clé publique existe (même fonctionnement que l'inscription).
(function () {
  var form = document.getElementById('formulaire-contact');
  if (!form) return;
  var sent = document.getElementById('contact-sent');
  var errorBox = document.getElementById('contact-error');
  var button = form.querySelector('button[type="submit"]');
  var turnstile = { siteKey: '', widgetId: null };
  var GENERIC_ERROR = "Le message n'a pas pu être envoyé. Réessayez, ou écrivez-nous directement par e-mail.";

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function showSent() {
    form.hidden = true;
    sent.hidden = false;
    sent.focus();
  }

  var status = new URLSearchParams(location.search).get('envoi');
  if (status === 'ok') showSent();
  else if (status === 'erreur') showError(GENERIC_ERROR);

  function setupTurnstile(siteKey) {
    var anchor = document.getElementById('contact-turnstile');
    if (!siteKey || turnstile.siteKey || !anchor) return;
    turnstile.siteKey = siteKey;
    window.demoContactTurnstileReady = function () {
      turnstile.widgetId = window.turnstile.render(anchor, { sitekey: siteKey, language: 'fr', appearance: 'interaction-only' });
    };
    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=demoContactTurnstileReady';
    script.async = true;
    document.head.appendChild(script);
  }

  fetch('/api/contact', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .then(function (data) { setupTurnstile(data.turnstileSiteKey); })
    .catch(function () {});

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.hidden = true;
    var data = new FormData(form);
    var payload = {
      nom: data.get('nom') || '',
      email: data.get('email') || '',
      sujet: data.get('sujet') || '',
      message: data.get('message') || '',
      site_web: data.get('site_web') || '',
      rgpd: form.querySelector('#contact-rgpd').checked,
      turnstileToken: turnstile.siteKey && window.turnstile && turnstile.widgetId !== null ? window.turnstile.getResponse(turnstile.widgetId) || '' : '',
    };
    var label = button.textContent;
    button.disabled = true;
    button.textContent = 'Envoi…';
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, body: body }; });
      })
      .then(function (r) {
        if (r.ok && r.body.ok) {
          form.reset();
          showSent();
          return;
        }
        if (r.body.turnstile && window.turnstile && turnstile.widgetId !== null) window.turnstile.reset(turnstile.widgetId);
        showError(r.body.error || GENERIC_ERROR);
      })
      .catch(function () { showError(GENERIC_ERROR); })
      .then(function () {
        button.disabled = false;
        button.textContent = label;
      });
  });
})();
