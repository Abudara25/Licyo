// Newsletter (2026-11-13, /admin/newsletter) : éditeur pour textes longs.
// - barre d'outils qui insère des repères simples (## titre, **gras**, - liste, [texte](lien), ---) ;
// - zone de texte qui s'agrandit, compteur de mots et temps de lecture ;
// - aperçu en direct (rendu exact par le serveur, action « render », rien n'est envoyé) ;
// - brouillon gardé dans ce navigateur (localStorage) jusqu'à l'envoi.
// Sans JavaScript, le formulaire fonctionne tel quel (aperçu à l'étape « Vérifier »).
(function () {
  'use strict';
  var DRAFT_KEY = 'demo.admin.newsletter.draft';
  var store = {
    get: function () { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } },
    set: function (v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
    clear: function () { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* idem */ } },
  };

  // Page « Newsletter envoyée » : le brouillon n'a plus lieu d'être.
  if (document.querySelector('[data-nl-sent]')) { store.clear(); return; }

  var form = document.querySelector('[data-nl-editor]');
  if (!form) return;
  var subject = form.querySelector('#nl-subject');
  var text = form.querySelector('#nl-message');
  var counter = form.querySelector('[data-nl-count]');
  var frame = form.querySelector('[data-nl-frame]');
  var toolbar = form.querySelector('[data-nl-toolbar]');
  var draftNote = form.querySelector('[data-nl-draft]');
  if (toolbar) toolbar.hidden = false;

  // --- Brouillon -------------------------------------------------------------------------
  var draft = store.get();
  if (draft && !subject.value && !text.value && (draft.subject || draft.message)) {
    subject.value = draft.subject || '';
    text.value = draft.message || '';
    if (draftNote) draftNote.hidden = false;
  }
  var saveDraft = function () { store.set({ subject: subject.value, message: text.value, at: Date.now() }); };
  var discard = form.querySelector('[data-nl-discard]');
  if (discard) {
    discard.addEventListener('click', function () {
      store.clear();
      subject.value = '';
      text.value = '';
      if (draftNote) draftNote.hidden = true;
      refresh();
      subject.focus();
    });
  }

  // --- Hauteur et compteur ----------------------------------------------------------------
  var grow = function () {
    text.style.overflowY = 'hidden';
    text.style.height = 'auto';
    text.style.height = Math.max(text.scrollHeight + 2, 360) + 'px';
  };
  var count = function () {
    if (!counter) return;
    var plain = text.value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_\-]+/g, ' ');
    var words = (plain.match(/[\p{L}\p{N}’']+/gu) || []).length;
    var minutes = Math.max(1, Math.round(words / 200));
    counter.textContent = words
      ? words.toLocaleString('fr-FR') + ' mot' + (words > 1 ? 's' : '') + ' · environ ' + minutes + ' min de lecture · ' + text.value.length.toLocaleString('fr-FR') + ' / ' + Number(text.maxLength).toLocaleString('fr-FR') + ' caractères'
      : '';
  };

  // --- Aperçu en direct --------------------------------------------------------------------
  var timer = null;
  var pending = null;
  var render = function () {
    if (!frame || !window.fetch) return;
    if (pending && pending.abort) pending.abort();
    pending = window.AbortController ? new AbortController() : null;
    var data = new FormData(form);
    data.set('action', 'render');
    fetch(form.getAttribute('action') || location.pathname, { method: 'POST', body: data, credentials: 'same-origin', signal: pending && pending.signal })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        if (!json || !json.html) return;
        var doc = frame.contentDocument;
        var y = doc && doc.scrollingElement ? doc.scrollingElement.scrollTop : 0;
        frame.srcdoc = json.html;
        frame.onload = function () {
          try { frame.contentDocument.scrollingElement.scrollTop = y; } catch (e) { /* iframe isolée */ }
        };
      })
      .catch(function () { /* aperçu indisponible : l'étape « Vérifier » reste disponible */ });
  };
  var refresh = function () {
    grow();
    count();
    clearTimeout(timer);
    timer = setTimeout(render, 700);
  };

  subject.addEventListener('input', function () { saveDraft(); refresh(); });
  text.addEventListener('input', function () { saveDraft(); refresh(); });
  form.addEventListener('change', function (e) { if (e.target.name === 'greet') render(); });

  // --- Barre d'outils ----------------------------------------------------------------------
  var replace = function (start, end, value, selStart, selEnd) {
    text.focus();
    text.setRangeText(value, start, end, 'end');
    text.setSelectionRange(start + selStart, start + selEnd);
    saveDraft();
    refresh();
  };
  // Début et fin de la ou des lignes sélectionnées.
  var lineBounds = function () {
    var v = text.value;
    var start = v.lastIndexOf('\n', text.selectionStart - 1) + 1;
    var endIdx = v.indexOf('\n', text.selectionEnd);
    return { start: start, end: endIdx === -1 ? v.length : endIdx };
  };
  // Bloc isolé par des lignes vides avant et après.
  var block = function (content, selStart, selEnd) {
    var v = text.value;
    var at = text.selectionStart;
    var before = v.slice(0, at);
    var after = v.slice(text.selectionEnd);
    var pre = !before ? '' : /\n\n$/.test(before) ? '' : /\n$/.test(before) ? '\n' : '\n\n';
    var post = !after ? '\n' : /^\n\n/.test(after) ? '' : /^\n/.test(after) ? '\n' : '\n\n';
    replace(at, text.selectionEnd, pre + content + post, pre.length + selStart, pre.length + selEnd);
  };
  var actions = {
    h2: function (sel) { var t = sel || 'Titre de la rubrique'; block('## ' + t, 3, 3 + t.length); },
    h3: function (sel) { var t = sel || 'Sous-titre'; block('### ' + t, 4, 4 + t.length); },
    bold: function (sel) {
      var t = sel || 'texte en gras';
      replace(text.selectionStart, text.selectionEnd, '**' + t + '**', 2, 2 + t.length);
    },
    list: function () {
      var b = lineBounds();
      var lines = text.value.slice(b.start, b.end).split('\n');
      var empty = lines.length === 1 && !lines[0].trim();
      if (empty) { block('- premier point\n- deuxième point', 2, 15); return; }
      var out = lines.map(function (l) { return /^\s*[-*•]\s+/.test(l) || !l.trim() ? l : '- ' + l; }).join('\n');
      text.setSelectionRange(b.start, b.end);
      replace(b.start, b.end, out, 0, out.length);
    },
    link: function (sel) {
      var t = sel || 'texte du lien';
      var v = '[' + t + '](https://)';
      replace(text.selectionStart, text.selectionEnd, v, t.length + 3, v.length - 1);
    },
    button: function (sel) {
      var t = sel || 'En savoir plus';
      var v = '[' + t + '](https://)';
      block(v, t.length + 3, v.length - 1);
    },
    hr: function () { block('---', 3, 3); },
  };
  form.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-nl-insert]');
    if (!btn) return;
    e.preventDefault();
    var sel = text.value.slice(text.selectionStart, text.selectionEnd).replace(/\n+/g, ' ').trim();
    var fn = actions[btn.getAttribute('data-nl-insert')];
    if (fn) fn(sel);
  });
  // Raccourcis : Ctrl/Cmd + B (gras), Ctrl/Cmd + K (lien).
  text.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var key = e.key.toLowerCase();
    if (key !== 'b' && key !== 'k') return;
    e.preventDefault();
    var sel = text.value.slice(text.selectionStart, text.selectionEnd).replace(/\n+/g, ' ').trim();
    actions[key === 'b' ? 'bold' : 'link'](sel);
  });

  // --- Onglets « Texte / Aperçu » (écrans étroits, sous 1180 px : l'aperçu n'a pas la place à côté) ---------------
  var views = document.querySelector('[data-nl-views]');
  if (views) {
    views.hidden = false;
    form.setAttribute('data-view', 'edit');
    views.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-nl-view]');
      if (!tab) return;
      var view = tab.getAttribute('data-nl-view');
      form.setAttribute('data-view', view);
      views.querySelectorAll('[data-nl-view]').forEach(function (b) { b.setAttribute('aria-selected', String(b === tab)); });
      if (view === 'preview') { clearTimeout(timer); render(); }
      else grow();
    });
  }

  grow();
  count();
  if (text.value || subject.value) render();
})();
