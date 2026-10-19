# Licyo

Site web + CRM pour clubs sportifs, tous sports confondus. Chaque club a son site public à ses couleurs et un espace d'administration commun : inscriptions en ligne, dossiers signés, photos, paiements HelloAsso, adhérents, relances automatiques et e-mails aux familles.

Le dépôt contient un club de démonstration fictif, **Club Démo** (Sportville), qui sert d'exemple et de base de tests.

## Démarrer

```
npm ci
npm run check   # vérifie les fichiers générés et lance tous les tests
```

Serveur local : `npm run build`, puis
`npx wrangler pages dev dist --d1 DB --kv INSCRIPTION_STATUS --r2 DOSSIERS --binding SETUP_SECRET=<test>`, puis `/admin/premier-acces`.

## Organisation du code

| Dossier | Rôle |
|---|---|
| `renderer/` | Moteur qui génère les pages publiques d'un club |
| `sites/` | Configuration et contenus de chaque club (`sites/club-demo/`) |
| `styles/` | Thème et palettes, compilés dans `assets/css/styles.css` |
| `functions/` | API, espace d'administration, espace famille (Cloudflare Pages Functions) |
| `workers/cron/` | Tâche quotidienne : relances et récapitulatif |
| `prototypes/platform-crm/` | Maquette de la console de gestion des clubs |
| `tests/` | Tests (`node:test`, base D1 simulée) et tests visuels (Playwright) |

Détails, règles et dette technique : `CLAUDE.md`.
