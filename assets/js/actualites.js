// Rend dynamiquement les cartes d'actualités de l'organisation (/api/actualites, fichier édité via
// /admin — Sveltia CMS). Utilisé par actualites.html (grille complète + filtres) et par
// index.html (3 derniers articles, sans filtres). Repli sur le message "bientôt disponible"
// (déjà présent dans le HTML, masqué via [hidden]) tant qu'il n'y a aucun article.

const CATEGORY_LABELS = {
  club: 'Club',
  inscriptions: 'Inscriptions',
  benevolat: 'Bénévolat',
  evenement: 'Événement',
  partenariat: 'Partenariat',
};

const CATEGORY_ICONS = {
  club: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  inscriptions: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 13l2 2 4-4"/>',
  benevolat: '<path d="M12 21s-7-5.2-9.5-9.4C.7 8 2.2 4 6 3.2c2.1-.4 4 .6 5 2.3 1-1.7 2.9-2.7 5-2.3C19.8 4 21.3 8 19.5 11.6 17 15.8 12 21 12 21z"/>',
  evenement: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 3v4M16 3v4"/><path d="M12 12.5l1.1 2.2 2.4.3-1.8 1.7.4 2.3-2.1-1.1-2.1 1.1.4-2.3-1.8-1.7 2.4-.3z"/>',
  partenariat: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
};

function formatDate(iso) {
  try {
    // new Date("YYYY-MM-DD") est parsé comme minuit UTC : on force le formatage en UTC pour
    // éviter qu'un fuseau très négatif (ex. UTC-8) ne fasse glisser l'affichage d'un jour.
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const escapeHtml = (str = '') =>
  str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cardHTML(article) {
  const label = CATEGORY_LABELS[article.category] || 'Club';
  const icon = CATEGORY_ICONS[article.category] || CATEGORY_ICONS.club;
  const slug = encodeURIComponent(article.slug);
  const title = escapeHtml(article.title);
  const excerpt = escapeHtml(article.excerpt || '');
  const media = article.image
    ? `<img class="card-media-bg" src="${escapeHtml(article.image)}" alt="" aria-hidden="true" loading="lazy"><img src="${escapeHtml(article.image)}" alt="" loading="lazy">`
    : `<svg class="icon-illustration" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;

  return `
    <article class="card" data-category="${article.category}">
      <div class="card-media">${media}<span class="tag">${label}</span></div>
      <div class="card-body">
        <span class="card-date">${formatDate(article.date)}</span>
        <h3><a href="actualites/${slug}" style="color:inherit;text-decoration:none;">${title}</a></h3>
        <p>${excerpt}</p>
        <a href="actualites/${slug}" class="card-link">Lire la suite</a>
      </div>
    </article>
  `;
}

async function initActualites() {
  const grid = document.getElementById('actualites-grid');
  const fallback = document.getElementById('actualites-empty');
  if (!grid) return;

  let articles = [];
  try {
    // Actualités de l'organisation du domaine, choisies par le serveur (functions/api/actualites.js).
    const res = await fetch('/api/actualites', { cache: 'no-store' });
    if (res.ok) ({ articles = [] } = await res.json());
  } catch {
    // Pas d'articles disponibles : on garde le repli "bientôt disponible".
  }

  articles.sort((a, b) => (a.date < b.date ? 1 : -1));

  if (!articles.length) {
    if (fallback) fallback.hidden = false;
    return;
  }

  const limit = Number(grid.dataset.limit) || articles.length;
  grid.innerHTML = articles.slice(0, limit).map(cardHTML).join('');
  grid.hidden = false;

  const moreLink = document.getElementById('actualites-more');
  if (moreLink) moreLink.hidden = false;

  const filterBar = document.getElementById('actualites-filters');
  if (!filterBar) return;
  filterBar.hidden = false;

  const cards = grid.querySelectorAll('[data-category]');
  filterBar.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBar.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const filter = btn.dataset.filter;
      cards.forEach((card) => {
        card.style.display = filter === 'all' || card.dataset.category === filter ? '' : 'none';
      });
    });
  });
}

document.addEventListener('DOMContentLoaded', initActualites);
