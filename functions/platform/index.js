// Console fondateur : interface de la maquette « Licyo Platform » (assets/platform-app), servie telle quelle.
// Ses données viennent de /platform/donnees (réelles, opérateur connecté) ; ses actions passent par /platform/api/*.
const STYLES = ['tokens', 'base', 'layout', 'components', 'pages'];

export function onRequestGet() {
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Licyo Platform</title>
  <link rel="icon" href="data:,">
  ${STYLES.map((s) => `<link rel="stylesheet" href="/assets/platform-app/styles/${s}.css">`).join('\n  ')}
  <script type="module" src="/assets/platform-app/src/main.js"></script>
</head>
<body>
  <a class="skip-link" href="#main-content">Aller au contenu</a>
  <div class="app">
    <div id="sidebar-slot" class="sidebar-slot"></div>
    <div class="main-col">
      <div id="topbar-slot"></div>
      <main id="main-content" class="content" tabindex="-1"></main>
    </div>
  </div>
  <div id="modal-root"></div>
  <div id="toasts" class="toasts" role="status" aria-live="polite" aria-atomic="false"></div>
  <form id="logout-form" method="POST" action="/platform/deconnexion" hidden></form>
  <form id="csrf-source" method="POST" action="/platform" hidden></form>
  <noscript>La console nécessite JavaScript.</noscript>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
}
