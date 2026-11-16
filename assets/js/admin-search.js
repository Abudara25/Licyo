// Suggestions de la recherche globale (barre du haut de l'admin, 2026-11-13) : pendant la frappe, quelques résultats
// par type (enfants, responsables, éducateurs, pré-inscriptions, catégories) lus sur /admin/recherche?format=json.
// Flèches haut/bas pour choisir, Entrée pour ouvrir, Échap pour fermer. Sans JavaScript, le formulaire mène à la page
// complète des résultats. Le texte reçu est inséré avec textContent, jamais comme du HTML.
(() => {
  const input = document.getElementById('adm-global-query');
  const box = document.getElementById('adm-global-suggest');
  if (!input || !box) return;
  const form = input.form;
  let timer = 0;
  let controller = null;
  let options = [];
  let active = -1;

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function close() {
    box.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index) {
    options.forEach((o, i) => o.classList.toggle('is-active', i === index));
    active = index;
    if (index >= 0) {
      input.setAttribute('aria-activedescendant', options[index].id);
      options[index].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function render(data) {
    box.replaceChildren();
    options = [];
    if (!data.total) {
      box.append(el('p', 'adm-suggest-empty', `Aucun résultat pour « ${data.q} »`));
    } else {
      data.groups.forEach((group) => {
        const head = el('div', 'adm-suggest-lab');
        head.append(el('span', '', group.label), el('span', '', String(group.count)));
        box.append(head);
        group.items.forEach((item) => {
          const link = el('a', 'adm-suggest-opt');
          link.href = item.href;
          link.id = `adm-suggest-${options.length}`;
          link.setAttribute('role', 'option');
          const text = el('span', 'adm-suggest-text');
          text.append(el('strong', '', item.title), el('small', '', item.sub));
          link.append(text, el('span', `adm-tag is-${item.tone}`, item.tag));
          box.append(link);
          options.push(link);
        });
      });
    }
    const all = el('a', 'adm-suggest-all', data.total ? `Voir les ${data.total} résultats` : 'Ouvrir la recherche');
    all.href = `/admin/recherche?q=${encodeURIComponent(data.q)}`;
    box.append(all);
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  }

  async function load(q) {
    controller?.abort();
    controller = new AbortController();
    try {
      const res = await fetch(`/admin/recherche?format=json&q=${encodeURIComponent(q)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) return close();
      const data = await res.json();
      if (input.value.trim() === q) render(data);
    } catch {
      /* requête annulée ou réseau : la page complète reste disponible */
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(() => load(q), 180);
  });
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      highlight((active + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault();
      highlight(active <= 0 ? options.length - 1 : active - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      window.location.href = options[active].href;
    } else if (e.key === 'Escape') {
      close();
    }
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) close();
  });
  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2 && box.childElementCount) {
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
  });
})();
