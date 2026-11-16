// Routage par fragment (#/…) : navigation seulement. Un segment d'URL n'est JAMAIS une autorité ;
// dans la future console, l'organisation consultée sera contrôlée côté serveur à chaque requête.
export const ORG_TABS = ['apercu', 'configuration', 'utilisateurs', 'modules', 'domaines', 'facturation', 'activite', 'audit'];

export function parseRoute(hash) {
  const path = String(hash || '').replace(/^#/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const [section, id, sub] = parts;
  switch (section) {
    case undefined:
    case 'dashboard':
      return { name: 'dashboard' };
    case 'organisations':
      if (!id) return { name: 'organizations' };
      return { name: 'organization', id, tab: ORG_TABS.includes(sub) ? sub : 'apercu' };
    case 'onboarding':
      if (id === 'nouveau') return { name: 'wizard', step: Math.min(9, Math.max(1, Number.parseInt(sub, 10) || 1)) };
      return { name: 'onboarding' };
    case 'domaines':
      return { name: 'domains' };
    case 'plans':
      return { name: 'plans' };
    case 'sante':
      return { name: 'health' };
    case 'support':
      return { name: 'support' };
    case 'audit':
      return { name: 'audit' };
    case 'parametres':
      return { name: 'settings' };
    default:
      return { name: 'not-found', path };
  }
}

export const href = (...segments) => `#/${segments.map((s) => encodeURIComponent(s)).join('/')}`;
