// Worker programmé : Cloudflare Pages ne sait pas lancer de tâche à heure fixe, ce Worker appelle donc
// chaque matin la route /api/cron du site, qui fait le vrai travail (functions/api/cron.js).
// Déploiement et secret : voir la section "Automatisations" de CLAUDE.md.
export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.SITE_URL}/api/cron`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }).then((res) => {
        if (!res.ok) throw new Error(`/api/cron a répondu ${res.status}`);
      })
    );
  },
};
