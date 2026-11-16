// Code Pass'Sport : mise en forme pendant la saisie (majuscules, tirets « 26-XXXX-XXXX »), même règle que
// functions/_shared/pass-sport.js, qui revérifie côté serveur. S'applique à tout champ name="passSportCode".
(function () {
  'use strict';
  var RE = /^\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  function clean(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10);
  }
  function format(raw) {
    return [raw.slice(0, 2), raw.slice(2, 6), raw.slice(6, 10)].filter(Boolean).join('-');
  }

  function attach(input) {
    input.setAttribute('autocapitalize', 'characters');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('maxlength', '12');

    function validity() {
      var value = input.value;
      input.setCustomValidity(!value || RE.test(value) ? '' : "Code Pass'Sport incomplet : 10 lettres ou chiffres, au format 26-XXXX-XXXX.");
    }

    input.addEventListener('input', function () {
      var before = input.value;
      // Position du curseur exprimée en nombre de caractères utiles, pour la retrouver après l'ajout des tirets.
      var caret = typeof input.selectionStart === 'number' ? clean(before.slice(0, input.selectionStart)).length : null;
      var raw = clean(before);
      var formatted = format(raw);
      if (formatted !== before) {
        input.value = formatted;
        if (caret !== null && document.activeElement === input) {
          var pos = caret + (caret > 6 ? 2 : caret > 2 ? 1 : 0);
          // Tiret ajouté juste après le curseur en fin de bloc : le placer après.
          if (formatted.charAt(pos) === '-' && caret === raw.length) pos += 1;
          pos = Math.min(pos, formatted.length);
          try { input.setSelectionRange(pos, pos); } catch (e) { /* type sans sélection */ }
        }
      }
      validity();
    });
    input.addEventListener('blur', validity);
    if (input.value) {
      input.value = format(clean(input.value));
      validity();
    }
  }

  function init() {
    var inputs = document.querySelectorAll('input[name="passSportCode"]');
    for (var i = 0; i < inputs.length; i++) attach(inputs[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
