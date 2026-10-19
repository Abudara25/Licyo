// Aide à la saisie des communes (inscription.html, /reinscription/<token>, /pre-inscription-u10), via le service de
// géocodage de la Géoplateforme de l'IGN (data.geopf.fr, gratuit, sans clé, déjà utilisé pour les adresses ; seul le
// code postal ou le début du nom de la commune est envoyé, jamais un nom de personne). Trois usages, même logique :
//   - lieu de naissance : pays, puis code postal → commune (une seule : remplie ; plusieurs : liste à choisir), ou
//     début du nom de la ville → communes proposées (le code postal est rempli, sauf pour Paris, Lyon et Marseille
//     où il dépend de l'arrondissement) ; né à l'étranger : code postal masqué, ville libre, aucune suggestion ;
//   - adresse de résidence : code postal tapé à la main → ville (les suggestions d'adresse, adresse-autocomplete.js,
//     remplissent déjà les deux quand on choisit une adresse) ;
//   - pré-inscription U10 : pays et ville seulement → recherche par le nom.
// 2026-10-08 : geo.api.gouv.fr (utilisé d'abord) répondait parfois en 3 à 7 s : sur téléphone, rien ne s'affichait
// avant que la famille passe au champ suivant. Chaque requête est en plus limitée à 5 s. Sans JavaScript, ou si le
// service ne répond pas, tout reste à saisir à la main.
(function () {
  'use strict';

  const API_URL = 'https://data.geopf.fr/geocodage/search';
  const MIN_NAME_CHARS = 3;
  const DELAY_MS = 200;
  const TIMEOUT_MS = 5000;
  // Communes à arrondissements : leur code postal dépend de l'arrondissement, il n'est pas deviné.
  const MULTI_POSTCODE = ['paris', 'lyon', 'marseille'];

  const normalize = (value) =>
    String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  const isFrance = (value) => ['', 'france', 'fr'].includes(normalize(value));

  // config : { country?, postcode?, city, list, nameSearch }
  function attach(config) {
    const country = config.country && document.getElementById(config.country);
    const postcode = config.postcode && document.getElementById(config.postcode);
    const city = document.getElementById(config.city);
    const list = document.getElementById(config.list);
    if (!city || !list || (config.postcode && !postcode) || !window.fetch) return;
    const postcodeField = postcode && postcode.closest('.form-field');
    const france = () => !country || isFrance(country.value);

    let communes = []; // communes du code postal saisi : [{ nom, code }]
    let shown = []; // suggestions affichées : [{ nom, codePostal, detail }]
    let activeIndex = -1;
    let controller = null;
    let timer = null;
    let lastCode = '';
    let lastName = '';

    city.setAttribute('role', 'combobox');
    city.setAttribute('aria-autocomplete', 'list');
    city.setAttribute('aria-controls', list.id);
    city.setAttribute('aria-expanded', 'false');

    function close() {
      list.hidden = true;
      list.textContent = '';
      shown = [];
      activeIndex = -1;
      city.setAttribute('aria-expanded', 'false');
      city.removeAttribute('aria-activedescendant');
    }

    function open(items) {
      list.textContent = '';
      shown = items;
      items.forEach(function (item, i) {
        const option = document.createElement('li');
        option.id = list.id + '-' + i;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        const label = document.createElement('span');
        label.className = 'address-suggestion-street';
        label.textContent = item.nom;
        const detail = document.createElement('span');
        detail.className = 'address-suggestion-city';
        detail.textContent = item.detail;
        option.append(label, detail);
        list.appendChild(option);
      });
      activeIndex = -1;
      list.hidden = items.length === 0;
      city.setAttribute('aria-expanded', items.length ? 'true' : 'false');
    }

    function setActive(index) {
      const options = list.children;
      if (activeIndex >= 0 && options[activeIndex]) options[activeIndex].setAttribute('aria-selected', 'false');
      activeIndex = index;
      if (index >= 0 && options[index]) {
        options[index].setAttribute('aria-selected', 'true');
        options[index].scrollIntoView({ block: 'nearest' });
        city.setAttribute('aria-activedescendant', options[index].id);
      }
    }

    function fill(name, code) {
      city.value = name;
      // Code postal rempli seulement s'il est connu sans ambiguïté et que le champ est vide.
      if (postcode && code && !postcode.value) {
        postcode.value = code;
        lastCode = code;
      }
      close();
      city.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function choose(index) {
      const item = shown[index];
      if (item) fill(item.nom, item.codePostal);
    }

    async function request(params) {
      if (controller) controller.abort();
      const current = new AbortController();
      controller = current;
      const timer = setTimeout(function () { current.abort(); }, TIMEOUT_MS);
      try {
        const response = await fetch(API_URL + '?' + new URLSearchParams(params), { signal: current.signal });
        if (!response.ok) return null;
        const data = await response.json();
        return (data && Array.isArray(data.features) ? data.features : []).map(function (f) { return f && f.properties; }).filter(Boolean);
      } finally {
        clearTimeout(timer);
      }
    }

    // Code postal → communes (une seule : remplie ; plusieurs : liste filtrée par ce qui est déjà tapé).
    async function byPostcode(code, { keepCity = false } = {}) {
      try {
        const data = await request({ q: code, type: 'municipality', postcode: code, limit: '20' });
        if (!data || postcode.value !== code) return;
        communes = Array.from(new Set(data.filter(function (p) { return p.postcode === code && p.name; }).map(function (p) { return p.name; })))
          .sort(function (a, b) { return a.localeCompare(b, 'fr'); });
        if (keepCity) return;
        if (communes.length === 1) fill(communes[0]);
        else if (communes.length > 1) {
          if (!communes.includes(city.value)) city.value = '';
          openFromPostcode();
        }
      } catch (error) {
        // Service indisponible ou trop lent : la ville reste à saisir.
      }
    }

    function openFromPostcode() {
      const typed = normalize(city.value);
      if (communes.some(function (nom) { return normalize(nom) === typed; })) return close();
      open(
        communes
          .filter(function (nom) { return !typed || normalize(nom).includes(typed); })
          .map(function (nom) { return { nom: nom, codePostal: '', detail: postcode.value }; })
      );
    }

    // Début du nom → communes (classées par le service, avec le département pour départager les homonymes).
    async function byName(name) {
      try {
        const data = await request({ q: name, type: 'municipality', autocomplete: '1', limit: '8' });
        if (!data || normalize(city.value) !== normalize(name)) return;
        const seen = new Set();
        const items = data
          .filter(function (p) { return p.name; })
          .map(function (p) {
            const dept = String(p.context || '').split(',')[0].trim();
            const multi = MULTI_POSTCODE.includes(normalize(p.name));
            return { nom: p.name, codePostal: multi ? '' : p.postcode || '', detail: dept ? `(${dept})` : '' };
          })
          .filter(function (item) {
            const key = item.nom + item.detail;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 6);
        if (items.length === 1 && normalize(items[0].nom) === normalize(name)) return close();
        open(items);
      } catch (error) {
        // Service indisponible ou trop lent : la ville reste à saisir.
      }
    }

    function onCityInput() {
      if (!france()) return close();
      if (communes.length > 1) return openFromPostcode();
      if (!config.nameSearch || communes.length === 1) return;
      const name = city.value.trim();
      clearTimeout(timer);
      if (name.length < MIN_NAME_CHARS) {
        lastName = '';
        return close();
      }
      if (name === lastName) return;
      timer = setTimeout(function () {
        lastName = name;
        byName(name);
      }, DELAY_MS);
    }

    function syncCountry() {
      const fr = france();
      if (postcodeField) postcodeField.hidden = !fr;
      if (postcode) {
        postcode.required = fr && Boolean(config.postcodeRequired);
        if (!fr) {
          postcode.value = '';
          communes = [];
          lastCode = '';
        }
      }
      if (!fr) close();
    }

    if (country) {
      country.addEventListener('input', syncCountry);
      syncCountry();
    }

    if (postcode) {
      postcode.addEventListener('input', function () {
        const digits = postcode.value.replace(/\D/g, '').slice(0, 5);
        if (digits !== postcode.value) postcode.value = digits;
        if (digits === lastCode) return;
        lastCode = digits;
        communes = [];
        close();
        if (digits.length === 5 && france()) byPostcode(digits);
      });
    }

    city.addEventListener('focus', function () {
      if (communes.length > 1) openFromPostcode();
    });
    city.addEventListener('input', onCityInput);
    city.addEventListener('keydown', function (event) {
      if (list.hidden || !shown.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((activeIndex + 1) % shown.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex <= 0 ? shown.length - 1 : activeIndex - 1);
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        choose(activeIndex);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
    // mousedown annulé (émis aussi au toucher) : sinon le blur fermerait la liste avant le clic.
    list.addEventListener('mousedown', function (event) { event.preventDefault(); });
    list.addEventListener('click', function (event) {
      const option = event.target.closest('[role="option"]');
      if (option) choose(Array.prototype.indexOf.call(list.children, option));
    });
    city.addEventListener('blur', close);

    // Formulaire prérempli (réinscription) : prépare la liste du code postal sans toucher à la ville.
    if (postcode && france() && /^\d{5}$/.test(postcode.value)) {
      lastCode = postcode.value;
      byPostcode(postcode.value, { keepCity: true });
    }
  }

  function init() {
    attach({ country: 'pays-naissance', postcode: 'cp-naissance', city: 'ville-naissance', list: 'ville-naissance-suggestions', nameSearch: true, postcodeRequired: true });
    attach({ postcode: 'code-postal', city: 'ville', list: 'ville-suggestions', nameSearch: false });
    attach({ country: 'prein-pays-naissance', city: 'prein-ville-naissance', list: 'prein-ville-naissance-suggestions', nameSearch: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
