// Worker programmé : Cloudflare Pages ne sait pas lancer de tâche à heure fixe, ce Worker appelle donc
// chaque matin la route /api/cron du site, qui fait le vrai travail (functions/api/cron.js).
// Déploiement et secret : voir la section "Automatisations" de CLAUDE.md.
// Deux déclencheurs (wrangler.toml) : le passage quotidien (toutes les tâches) et, toutes les 15 minutes, l'envoi des
// newsletters programmées seulement (?taches=newsletters).
export const QUICK_CRON = '*/15 * * * *';
export const cronUrl = (siteUrl, cron) => (cron === QUICK_CRON ? `${siteUrl}/api/cron?taches=newsletters` : `${siteUrl}/api/cron`);

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      fetch(cronUrl(env.SITE_URL, controller.cron), { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }).then((res) => {
        if (!res.ok) throw new Error(`/api/cron a répondu ${res.status}`);
      })
    );
  },
};
