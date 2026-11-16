// Catégories d'âge actives + saison en cours : catégories et tarif lus en D1 (source de vérité, voir
// _shared/public-data.js), saison et dates dans le KV (_shared/settings-kv.js), le tout géré depuis
// /admin/categories. Un tarif absent est renvoyé null (jamais une valeur par défaut). Consommé par assets/js/inscription.js
// pour construire dynamiquement le <select> catégorie, la correspondance année de naissance →
// catégorie et les liens/widgets HelloAsso, sans devoir toucher au code à chaque saison.
import { getCategoriesConfig } from '../_shared/settings-kv.js';
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';

export async function onRequestGet({ request, env }) {
  const organization = await resolveOrganization(request, env);
  if (!organization) return unknownOrganization();
  const config = await getCategoriesConfig(env, organization.id);
  const categories = config.categories
    .filter((c) => c.active)
    .map((c) => ({
      id: c.id,
      label: c.label,
      anneeMin: c.anneeMin,
      anneeMax: c.anneeMax,
      helloAssoUrl: c.helloAssoUrl || '',
      helloAssoWidgetUrl: c.helloAssoWidgetUrl || '',
    }));

  return new Response(JSON.stringify({ saison: config.saison, prix: config.prix ?? null, categories, turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
