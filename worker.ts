// Point d'entrée du Worker Licyo : le Worker généré par OpenNext (fetch) + les tâches planifiées (scheduled).
//
// Le Cron Trigger (wrangler.jsonc, triggers.crons) appelle `scheduled`, qui rejoue une requête interne vers
// POST /api/cron dans le même Worker, avec le secret CRON_SECRET : les tâches tournent ainsi dans le contexte normal
// de l'application (liaisons D1, R2), sans dupliquer l'accès aux données. Voir src/lib/scheduled.ts.

// Fichier généré par `opennextjs-cloudflare build` ; worker.ts est exclu de tsconfig (vérifié par wrangler au déploiement).
import { default as handler } from './.open-next/worker.js';

type Env = { CRON_SECRET?: string };
type Ctx = { waitUntil(promise: Promise<unknown>): void };

export default {
  fetch: handler.fetch,

  async scheduled(controller: { cron: string }, env: Env, ctx: Ctx) {
    if (!env.CRON_SECRET) {
      console.error('[cron] CRON_SECRET absent : tâches planifiées non lancées');
      return;
    }
    const request = new Request('https://licyo.internal/api/cron', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CRON_SECRET}`, 'x-licyo-cron': controller.cron },
    });
    ctx.waitUntil(
      Promise.resolve(handler.fetch(request, env, ctx)).then(async (res: Response) => {
        if (!res.ok) console.error(`[cron] échec ${res.status} : ${(await res.text()).slice(0, 500)}`);
      }),
    );
  },
};
