// Suggestions d'adresse sur le champ #adresse (inscription.html, functions/reinscription/[token].js).
// Source : service de géocodage de la Géoplateforme de l'IGN (Base Adresse Nationale), gratuit, sans clé,
// qui remplace api-adresse.data.gouv.fr (dépréciée). Choisir une suggestion remplit aussi le code postal
// et la ville. Sans JavaScript, ou si le service ne répond pas, les trois champs restent à saisir à la main.
(function () {
  'use strict';

  const API_URL = 'https://data.geopf.fr/geocodage/search';
  // Proximité de Sportville : départage les rues homonymes (ex. rue de la Gare dans une commune voisine).
  const NEAR = { lat: 48.9719, lon: 2.2886 };
  const MIN_CHARS = 3;
  const MAX_RESULTS = 5;
  const DELAY_MS = 250;

  function init() {
    const input = document.getElementById('adresse');
    const list = document.getElementById('adresse-suggestions');
    if (!input || !list || !window.fetch) return;
    const postcodeInput = document.getElementById('code-postal');
    const cityInput = document.getElementById('ville');

    let results = [];
    let activeIndex = -1;
    let timer = null;
    let controller = null;
    let lastQuery = '';

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');

    function close() {
      list.hidden = true;
      list.textContent = '';
      results = [];
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(index) {
      const options = list.children;
      if (activeIndex >= 0 && options[activeIndex]) options[activeIndex].setAttribute('aria-selected', 'false');
      activeIndex = index;
      if (index >= 0 && options[index]) {
        options[index].setAttribute('aria-selected', 'true');
        options[index].scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', options[index].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function render() {
      list.textContent = '';
      results.forEach(function (props, i) {
        const option = document.createElement('li');
        option.id = 'adresse-suggestion-' + i;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        const street = document.createElement('span');
        street.className = 'address-suggestion-street';
        street.textContent = props.name;
        const city = document.createElement('span');
        city.className = 'address-suggestion-city';
        city.textContent = props.postcode + ' ' + props.city;
        option.append(street, city);
        list.appendChild(option);
      });
      activeIndex = -1;
      list.hidden = results.length === 0;
      input.setAttribute('aria-expanded', results.length ? 'true' : 'false');
    }

    function choose(index) {
      const props = results[index];
      if (!props) return;
      input.value = props.name;
      if (postcodeInput) postcodeInput.value = props.postcode;
      if (cityInput) cityInput.value = props.city;
      lastQuery = props.name;
      close();
      [input, postcodeInput, cityInput].forEach(function (field) {
        if (field) field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    async function search(query) {
      if (controller) controller.abort();
      controller = new AbortController();
      const params = new URLSearchParams({
        q: query, limit: String(MAX_RESULTS), autocomplete: '1', index: 'address',
        lat: String(NEAR.lat), lon: String(NEAR.lon),
      });
      try {
        const response = await fetch(API_URL + '?' + params, { signal: controller.signal });
        if (!response.ok) return close();
        const data = await response.json();
        if (input.value.trim() !== query || document.activeElement !== input) return;
        results = (data.features || [])
          .map(function (feature) { return feature.properties || {}; })
          .filter(function (props) { return props.name && props.postcode && props.city; });
        render();
      } catch (error) {
        if (error.name !== 'AbortError') close();
      }
    }

    input.addEventListener('input', function () {
      const query = input.value.trim();
      if (query === lastQuery) return;
      lastQuery = query;
      clearTimeout(timer);
      if (query.length < MIN_CHARS) {
        if (controller) controller.abort();
        return close();
      }
      timer = setTimeout(function () { search(query); }, DELAY_MS);
    });

    input.addEventListener('keydown', function (event) {
      if (list.hidden || !results.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((activeIndex + 1) % results.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(activeIndex <= 0 ? results.length - 1 : activeIndex - 1);
      } else if (event.key === 'Enter' && activeIndex >= 0) {
        event.preventDefault();
        choose(activeIndex);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    // mousedown annulé (émis aussi au toucher) : le champ garde le focus, sinon le blur fermerait la liste avant le clic.
    list.addEventListener('mousedown', function (event) { event.preventDefault(); });
    list.addEventListener('click', function (event) {
      const option = event.target.closest('[role="option"]');
      if (option) choose(Array.prototype.indexOf.call(list.children, option));
    });
    input.addEventListener('blur', close);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
