// Paramètres de la plateforme : politiques cibles de la future console (ADR-018), affichées en lecture seule.
import { html } from '../lib/html.js';
import { pageHeader, card, kvList } from '../components/card.js';
import { badge } from '../components/badge.js';
import { toggle } from '../components/form.js';
import { notice } from '../components/feedback.js';
import { ENVIRONMENT } from '../data/fixtures.js';

const policy = (label, value) => html`${value} ${badge('Politique cible', 'violet', { dot: false })}`;

export function render(ctx) {
  const n = ctx.state.notifications;
  return html`
    ${pageHeader({ title: 'Paramètres Platform', description: 'Réglages de la console de l’éditeur. Dans l’aperçu, rien n’est enregistré.' })}
    <div style="margin-bottom:16px">${notice('info', 'Ces politiques décrivent la future console. Elles ne sont pas implémentées dans ce prototype, qui n’a ni session ni authentification.')}</div>
    <div class="grid grid-2">
      ${card({ title: 'Environnement', body: kvList([['Environnement', `${ENVIRONMENT.label} (données fictives)`], ['Région des données', 'Union européenne'], ['Version', html`<span class="mono">${ENVIRONMENT.version}</span>`], ['Organisations', '14 (démonstration)']]) })}
      ${card({
        title: 'Sécurité de la console',
        body: kvList([
          ['Domaine', policy('Domaine', 'Enregistrable distinct de tout site de club')],
          ['Authentification', policy('MFA', 'MFA obligatoire (TOTP, puis clé d’accès)')],
          ['Session', policy('Session', '8 h, cookies __Host-, SameSite=Strict')],
          ['Accès réseau', policy('IP', 'Liste d’adresses autorisées (facultative)')],
        ]),
      })}
      ${card({
        title: 'Assistance aux clubs',
        body: kvList([
          ['Durée', policy('Durée', '30 min, renouvelable avec un nouveau motif')],
          ['Mode', policy('Mode', 'Lecture seule par défaut, écriture action par action')],
          ['Traçabilité', policy('Audit', 'Double journal : plateforme et club')],
          ['Consentement', policy('Club', 'Le club peut autoriser ou refuser l’assistance')],
        ]),
      })}
      ${card({
        title: 'Notifications de l’équipe',
        flush: true,
        body: html`${[
          ['incidents', 'Incidents SEV-1 et SEV-2', 'E-mail et notification immédiate'],
          ['billing', 'Impayés et fins de grâce', 'Résumé quotidien'],
          ['domains', 'Échecs de certificat et de DNS', 'Notification immédiate'],
          ['onboarding', 'Onboardings bloqués depuis 3 jours', 'Résumé hebdomadaire'],
        ].map(([key, label, desc]) => html`<div class="list-row"><div class="grow"><div style="font-weight:560">${label}</div><div class="muted" style="font-size:12px">${desc}</div></div>${toggle({ id: `notif-${key}`, checked: n[key], label, action: 'notif-toggle' })}</div>`)}`,
      })}
    </div>`;
}

export const actions = {
  'notif-toggle': (el, ctx) => {
    const key = el.id.replace('notif-', '');
    ctx.set({ notifications: { ...ctx.state.notifications, [key]: !ctx.state.notifications[key] } });
    ctx.toast('Préférence modifiée pour cet onglet seulement');
  },
};
