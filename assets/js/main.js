// Club Démo — interactions front-end (menu mobile, header au scroll, reveal, filtres actus)

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initMobileNav();
  initReveal();
  initNewsFilters();
  markActiveNavLink();
  initPlaceholderLinks();
  initArticleLightbox();
  initMapsConsent();
  initAdhesionCtaStatus();
  initEventTracking();
});

// Compte un clic ou un envoi pour tout élément marqué data-track-event, directement auprès du site
// (functions/api/track-event.js) : ni cookie, ni service tiers (Cloudflare Zaraz retiré le 2026-10-16).
// sendBeacon part même si la page change aussitôt (lien tel:, envoi de formulaire) ; un échec est ignoré.
function initEventTracking() {
  document.querySelectorAll('[data-track-event]').forEach((el) => {
    const eventName = el.dataset.trackEvent;
    const type = el.tagName === 'FORM' ? 'submit' : 'click';
    el.addEventListener(type, () => {
      const body = JSON.stringify({ event: eventName, page: location.pathname });
      try {
        if (!navigator.sendBeacon?.('/api/track-event', new Blob([body], { type: 'application/json' }))) {
          fetch('/api/track-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
        }
      } catch {
        // mesure facultative
      }
    });
  });
}

function initMapsConsent() {
  // La carte Google Maps n'est chargée qu'après un clic explicite (Google peut déposer
  // des cookies dès le chargement de l'iframe, donc pas de chargement automatique).
  document.querySelectorAll('.map-embed').forEach((container) => {
    const btn = container.querySelector('.map-embed-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = container.dataset.mapSrc;
      iframe.width = '100%';
      iframe.height = '100%';
      iframe.style.border = '0';
      iframe.style.display = 'block';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'no-referrer-when-downgrade';
      iframe.title = container.dataset.mapTitle || 'Carte';
      // tabIndex + focus() : replaceChildren retire le bouton cliqué du DOM, ce qui ferait
      // retomber le focus clavier sur <body> (perdu, sans repère) pour qui navigue au clavier
      // ou au lecteur d'écran.
      iframe.tabIndex = -1;
      container.replaceChildren(iframe);
      iframe.focus();
    });
  });
}

function initAdhesionCtaStatus() {
  // Présent sur les 6 pages (header + le CTA du hero sur index.html) : relabellisé en "Inscriptions
  // fermées" quand le club a fermé les inscriptions (voir /admin/inscriptions), pour ne pas laisser
  // croire que c'est encore ouvert avant même d'avoir cliqué. Reste cliquable — la page inscription
  // explique pourquoi et propose de nous contacter. Même endpoint que inscription.html
  // (assets/js/inscription.js), interrogé séparément ici : ce sont deux besoins différents (bouton
  // du header vs formulaire de la page), pas de source commune simple sans dupliquer le fetch.
  const ctas = document.querySelectorAll('.adhesion-cta');
  if (!ctas.length) return;

  fetch('/api/inscription-status')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data?.status !== 'closed') return;
      ctas.forEach((el) => {
        el.textContent = 'Inscriptions fermées';
        el.classList.remove('btn-primary');
        el.classList.add('btn-dark');
      });
    })
    .catch(() => {}); // en cas d'échec, le bouton garde son libellé par défaut ("Inscription")
}

function initPlaceholderLinks() {
  // Les liens sans destination réelle (ex: "Lire la suite" en attendant de vraies pages d'articles)
  // utilisent href="#" : on evite qu'un clic remonte la page en haut sans rien faire d'autre.
  document.querySelectorAll('a[href="#"]').forEach((link) => {
    link.addEventListener('click', (e) => e.preventDefault());
  });
}

function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

function initMobileNav() {
  const burger = document.querySelector('.burger');
  const nav = document.querySelector('.main-nav');
  const main = document.getElementById('main');
  if (!burger || !nav) return;

  // inert sur <main> pendant que le panneau mobile est ouvert : sans ça, le contenu masqué
  // derrière le panneau (position: fixed) reste dans l'ordre de tabulation, et un utilisateur
  // clavier peut tabuler dans du contenu invisible à l'écran.
  const closeNav = () => {
    burger.classList.remove('is-active');
    nav.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    if (main) main.inert = false;
  };

  burger.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    burger.classList.toggle('is-active', isOpen);
    burger.setAttribute('aria-expanded', String(isOpen));
    if (main) main.inert = isOpen;
  });

  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeNav));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeNav();
  });
}

function initReveal() {
  const items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  items.forEach((el, i) => {
    el.style.transitionDelay = `${Math.min(i % 4, 3) * 80}ms`;
    observer.observe(el);
  });
}

function initNewsFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('[data-category]');
  if (!filterBtns.length || !cards.length) return;

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const filter = btn.dataset.filter;

      cards.forEach((card) => {
        const match = filter === 'all' || card.dataset.category === filter;
        card.style.display = match ? '' : 'none';
      });
    });
  });
}

function initArticleLightbox() {
  const lightbox = document.getElementById('article-lightbox');
  const cards = document.querySelectorAll('article.card');
  if (!lightbox || !cards.length) return;

  const media = lightbox.querySelector('.lightbox-media');
  const dateEl = lightbox.querySelector('.lightbox-date');
  const titleEl = lightbox.querySelector('.lightbox-title');
  const textEl = lightbox.querySelector('.lightbox-text');

  const open = (card) => {
    const cardMedia = card.querySelector('.card-media');
    media.innerHTML = cardMedia ? cardMedia.innerHTML : '';
    dateEl.textContent = card.querySelector('.card-date')?.textContent || '';
    titleEl.textContent = card.querySelector('h3')?.textContent || '';
    textEl.textContent = card.querySelector('.card-body p')?.textContent || '';
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };

  const close = () => {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  cards.forEach((card) => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => open(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(card);
      }
    });
  });

  lightbox.querySelectorAll('[data-lightbox-close]').forEach((el) => el.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function markActiveNavLink() {
  // URLs propres (sans .html, Cloudflare Pages 308-redirige X.html vers X) : le pathname courant
  // se compare directement aux href absolus ("/", "/actualites"...) plutôt qu'à un nom de fichier.
  const current = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.main-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === current) {
      link.setAttribute('aria-current', 'page');
    }
  });
}
