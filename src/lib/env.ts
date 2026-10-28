/** Domaine racine du SaaS, sans protocole (ex. « licyo.fr » ou « localhost:3000 »). */
export function rootDomain(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000').toLowerCase();
}

/** URL publique de l'application (espace marketing, back-offices, webhooks). */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** URL publique du site d'un club : domaine personnalisé sinon sous-domaine. */
export function clubSiteUrl(club: { slug: string; custom_domain: string | null }): string {
  const protocol = appUrl().startsWith('https') ? 'https' : 'http';
  return club.custom_domain ? `https://${club.custom_domain}` : `${protocol}://${club.slug}.${rootDomain()}`;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}
