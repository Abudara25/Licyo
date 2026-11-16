// Préparation (création de table, colonne additive…) faite une fois par binding D1 et par instance du Worker.
//
// Incident du 2026-11-13 : la promesse de préparation était mémorisée et partagée entre requêtes. Quand la requête
// qui l'avait lancée se terminait avant elle (client parti, réponse déjà envoyée), le moteur Cloudflare refuse de
// la terminer pour les autres (« This promise was created by a request that has since ended, so it can never
// settle »). L'erreur n'était jamais oubliée : l'instance répondait 500 à chaque requête jusqu'à son recyclage
// (connexion admin « Espace introuvable », /api/categories en erreur 1101 une fois sur trois).
//
// Règles :
// - une préparation RÉUSSIE est notée (`done`) : les appels suivants ne l'attendent plus du tout ;
// - les appels simultanés d'une même requête ou d'autres requêtes partagent la préparation en cours ;
// - si l'attente d'une préparation lancée par UNE AUTRE requête échoue (quelle qu'en soit la raison), elle est
//   oubliée et la requête courante en lance une nouvelle, une seule fois ; une préparation qu'elle a lancée
//   elle-même et qui échoue est oubliée et l'erreur remonte (la requête suivante réessaiera).
// Les préparations doivent rester rejouables (CREATE … IF NOT EXISTS, colonne ajoutée après lecture de PRAGMA).
export function oncePerBinding() {
  const entries = new WeakMap();
  const forget = (db, entry) => {
    if (entries.get(db) === entry) entries.delete(db);
  };
  const start = (db, prepare) => {
    const entry = { done: false, promise: null };
    entry.promise = Promise.resolve().then(prepare);
    entries.set(db, entry);
    return entry;
  };
  return async function run(db, prepare) {
    const existing = entries.get(db);
    if (existing?.done) return;
    if (existing) {
      try {
        await existing.promise;
        existing.done = true;
        return;
      } catch {
        forget(db, existing);
      }
    }
    const entry = start(db, prepare);
    try {
      await entry.promise;
      entry.done = true;
    } catch (error) {
      forget(db, entry);
      throw error;
    }
  };
}
