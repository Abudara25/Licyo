// Déconnexion après inactivité dans l'espace admin (2026-10-10). Le serveur fait foi : la session expire
// data-idle-seconds après la dernière activité (functions/_shared/admin-auth.js, readSession). Ce script :
// - prolonge la session quand l'utilisateur agit (clic, frappe, défilement, toucher), au plus toutes les 5 minutes ;
// - prévient data-warning-seconds avant la coupure (fenêtre avec compte à rebours, « Rester connecté ») ;
// - à zéro, déconnecte et renvoie à l'écran de connexion (« déconnecté après inactivité ») ;
// - partage l'échéance entre les onglets ouverts (localStorage), et revérifie au retour sur l'onglet.
// Sur l'écran de connexion, il affiche seulement le message d'inactivité (?inactif=1).
(function () {
  var body = document.body;
  if (!body) return;
  if (body.classList.contains('adm-login-body')) {
    if (new URLSearchParams(location.search).get('inactif') === '1') {
      var note = document.getElementById('login-inactif');
      if (note) note.hidden = false;
    }
    return;
  }
  if (!document.querySelector('.adm-topnav')) return;

  var IDLE = Number(body.dataset.idleSeconds) || 1800;
  var WARN = Number(body.dataset.warningSeconds) || 120;
  var EXTEND_EVERY = Math.min(300, Math.floor(IDLE / 3)); // secondes d'avance consommées avant de reprolonger
  var KEY = 'demo-admin-deadline';
  var deadline = Date.now() + IDLE * 1000; // la page qui vient de s'afficher a prolongé la session
  var warnTimer = null;
  var tick = null;
  var dialog = null;
  var extending = false;
  var closing = false;

  function share() {
    try { localStorage.setItem(KEY, String(deadline)); } catch (e) {}
  }

  function logout() {
    if (closing) return;
    closing = true;
    location.href = '/admin/logout?inactif=1';
  }

  function setDeadline(remainingSeconds) {
    deadline = Date.now() + remainingSeconds * 1000;
    share();
    schedule();
  }

  function status(extend) {
    return fetch('/admin/session' + (extend ? '?prolonger=1' : ''), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 401) return { expired: true };
        return r.ok ? r.json() : null;
      })
      .catch(function () { return null; });
  }

  function schedule() {
    clearTimeout(warnTimer);
    var wait = deadline - WARN * 1000 - Date.now();
    if (wait <= 0) return check();
    hideDialog();
    warnTimer = setTimeout(check, Math.min(wait, 2147483647));
  }

  // Avant d'avertir ou de couper : l'échéance a pu être repoussée ailleurs (autre onglet, autre page ouverte).
  function check() {
    return status(false).then(function (data) {
      if (data && data.expired) return logout();
      if (!data) {
        // Réseau indisponible : on se fie à l'échéance connue.
        if (Date.now() >= deadline) return logout();
        return showDialog();
      }
      deadline = Date.now() + data.remaining * 1000;
      share();
      if (data.remaining <= 0) return logout();
      if (data.remaining > WARN + 2) return schedule();
      showDialog();
    });
  }

  function extend() {
    if (extending) return Promise.resolve();
    extending = true;
    return status(true).then(function (data) {
      extending = false;
      if (data && data.expired) return logout();
      if (data) setDeadline(data.remaining);
    });
  }

  function onActivity() {
    if (dialog && !dialog.hidden) return; // pendant l'alerte, seul « Rester connecté » prolonge
    if (deadline - Date.now() < (IDLE - EXTEND_EVERY) * 1000) extend();
  }

  function format(seconds) {
    var s = Math.max(0, Math.ceil(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function buildDialog() {
    dialog = document.createElement('div');
    dialog.className = 'adm-idle';
    dialog.hidden = true;
    dialog.innerHTML =
      '<div class="adm-idle-card" role="alertdialog" aria-modal="true" aria-labelledby="adm-idle-title" aria-describedby="adm-idle-text">' +
      '<p class="adm-idle-time" role="timer" aria-label="Temps restant"></p>' +
      '<h2 id="adm-idle-title">Toujours là ?</h2>' +
      '<p id="adm-idle-text">Sans activité, vous serez déconnecté à la fin du compte à rebours. Ce qui n’est pas enregistré sera perdu.</p>' +
      '<div class="adm-idle-actions">' +
      '<button type="button" class="adm-btn adm-btn-primary adm-idle-stay">Rester connecté</button>' +
      '<button type="button" class="adm-btn adm-btn-ghost adm-idle-leave">Se déconnecter</button>' +
      '</div></div>';
    body.appendChild(dialog);
    dialog.querySelector('.adm-idle-stay').addEventListener('click', function () {
      hideDialog();
      extend();
    });
    dialog.querySelector('.adm-idle-leave').addEventListener('click', function () {
      location.href = '/admin/logout';
    });
  }

  function render() {
    var left = (deadline - Date.now()) / 1000;
    if (left <= 0) {
      clearInterval(tick);
      return check();
    }
    dialog.querySelector('.adm-idle-time').textContent = format(left);
    document.title = '(' + format(left) + ') ' + baseTitle;
  }

  var baseTitle = document.title;
  function showDialog() {
    if (!dialog) buildDialog();
    var wasHidden = dialog.hidden;
    dialog.hidden = false;
    clearInterval(tick);
    render();
    tick = setInterval(render, 1000);
    if (wasHidden) dialog.querySelector('.adm-idle-stay').focus();
  }

  function hideDialog() {
    clearInterval(tick);
    document.title = baseTitle;
    if (dialog) dialog.hidden = true;
  }

  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'input'].forEach(function (type) {
    window.addEventListener(type, onActivity, { passive: true, capture: true });
  });

  // Autre onglet : il a prolongé la session (ou s'est déconnecté).
  window.addEventListener('storage', function (event) {
    if (event.key !== KEY || !event.newValue) return;
    var shared = Number(event.newValue);
    if (shared > deadline) {
      deadline = shared;
      schedule();
    }
  });

  // Retour sur l'onglet (téléphone mis en veille, autre application) : les minuteurs ont pu être suspendus.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check();
  });

  share();
  schedule();
})();
