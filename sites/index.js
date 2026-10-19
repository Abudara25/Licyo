// Registre des configurations de RÉFÉRENCE, par organisation (versionnées dans le code). Elles génèrent les pages
// statiques (scripts/build-pages.mjs) et amorcent la configuration en base (phase 4D.2B, functions/_shared/
// site-config.js), qui est la seule lue par le site public à l'exécution. Aucune valeur par défaut : une
// organisation sans site n'a PAS de site, jamais celui d'une autre organisation.
import { site as clubDemo } from './club-demo/site.js';

export const SITES = Object.freeze({ [clubDemo.organizationId]: clubDemo });

export function siteForOrganization(organizationId) {
  if (typeof organizationId !== 'string' || !organizationId) return null;
  return Object.prototype.hasOwnProperty.call(SITES, organizationId) ? SITES[organizationId] : null;
}
