// Équipe Licyo (maquette : « Paramètres Platform ») : comptes nominatifs des salariés, rôle et périmètre explicites.
// Réservé au propriétaire (team.manage). Le rôle Propriétaire ne se délègue pas ; son compte est protégé.
import { html } from '../_shared/platform-ui/html.js';
import { icon } from '../_shared/platform-ui/icons.js';
import { pageHeader, card } from '../_shared/platform-ui/card.js';
import { avatar, initialsOf } from '../_shared/platform-ui/avatar.js';
import { badge, consolePage, notice, formatDate } from '../_shared/platform-ui/kit.js';
import {
  listOperators,
  pendingOperatorInvites,
  inviteOperator,
  revokeOperatorInvite,
  setOperatorStatus,
  PlatformError,
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLE_DESCRIPTIONS,
} from '../_shared/platform-auth.js';

async function render(context, { message = '', error = '', created = null, values = {}, status = 200 } = {}) {
  const db = context.env.DB;
  const me = context.data.operator;
  const [operators, invites] = await Promise.all([listOperators(db), pendingOperatorInvites(db)]);
  const delegable = PLATFORM_ROLES.filter((r) => r !== 'owner');
  const content = html`
    ${pageHeader({ title: 'Équipe Licyo', description: 'Chaque salarié a son compte, avec un rôle et un périmètre. Personne ne reçoit tous les droits par facilité.' })}
    ${message ? notice('success', message, 'check') : ''}
    ${error ? notice('danger', error, 'alert') : ''}
    ${created
      ? card({
          title: 'Lien d’invitation à transmettre',
          subtitle: `Pour ${created.name} : valable 7 jours, une seule fois. Il ne sera plus affiché.`,
          body: html`<div class="copy-row"><label class="sr-only" for="op-link">Lien d’invitation</label><input class="input" id="op-link" readonly value="${created.url}"><button type="button" class="btn btn-secondary" data-copy="op-link">${icon('copy', 16)}Copier</button></div>`,
          className: 'section-gap',
        })
      : ''}
    <div class="grid grid-main section-gap">
      <div class="stack">
        ${card({
          title: 'Comptes',
          flush: true,
          body: html`${operators.map(
            (o) => html`<div class="list-row">${avatar(initialsOf(o.name))}<div class="grow"><div class="strong">${o.name}${o.id === me.id ? ' (vous)' : ''}</div><div class="muted small">${o.email} · ${PLATFORM_ROLE_LABELS[o.role]} · ${o.last_login_at ? `dernière connexion le ${formatDate(o.last_login_at)}` : 'jamais connecté'}</div></div>
              ${o.status === 'active' ? badge('Actif', 'success') : badge('Désactivé', 'neutral')}
              ${o.role !== 'owner' && o.id !== me.id
                ? html`<form method="POST" class="inline-form" ${o.status === 'active' ? html`data-confirm="Désactiver le compte de ${o.name} ? Ses connexions sont fermées aussitôt."` : ''}><input type="hidden" name="action" value="${o.status === 'active' ? 'disable' : 'enable'}"><input type="hidden" name="operatorId" value="${o.id}"><button class="btn btn-ghost btn-sm" type="submit">${o.status === 'active' ? 'Désactiver' : 'Réactiver'}</button></form>`
                : ''}</div>`
          )}
          ${invites.map((i) => html`<div class="list-row"><div class="grow"><div class="strong">${i.name}</div><div class="muted small">${i.email} · ${PLATFORM_ROLE_LABELS[i.role]} · invitation jusqu’au ${formatDate(i.expires_at)}</div></div>${badge('Invité', 'violet')}<form method="POST" class="inline-form"><input type="hidden" name="action" value="invite-revoke"><input type="hidden" name="inviteId" value="${i.id}"><button class="btn btn-ghost btn-sm" type="submit">Annuler</button></form></div>`)}`,
        })}
      </div>
      <div class="stack">
        ${card({
          title: 'Inviter un salarié',
          body: html`<form method="POST" class="stack-sm"><input type="hidden" name="action" value="invite">
            <div class="field"><label for="op-name">Prénom et nom</label><input class="input" id="op-name" name="name" maxlength="120" value="${values.name || ''}" required></div>
            <div class="field"><label for="op-email">Adresse e-mail</label><input class="input" id="op-email" name="email" type="email" maxlength="200" value="${values.email || ''}" required></div>
            <div class="field"><label for="op-role">Rôle</label><select class="select" id="op-role" name="role">${delegable.map((r) => html`<option value="${r}" ${values.role === r ? 'selected' : ''}>${PLATFORM_ROLE_LABELS[r]}</option>`)}</select></div>
            <ul class="muted small" style="margin:0 0 6px 18px">${delegable.map((r) => html`<li><strong>${PLATFORM_ROLE_LABELS[r]}</strong> : ${PLATFORM_ROLE_DESCRIPTIONS[r]}</li>`)}</ul>
            <button class="btn btn-primary" type="submit">${icon('plus', 16)}Créer l’invitation</button>
          </form>`,
        })}
        ${notice('warning', 'À venir avant d’ouvrir la console à des salariés : double authentification (MFA) et accès d’assistance temporaire aux clubs.', 'shield')}
      </div>
    </div>`;
  return consolePage(context, { title: 'Équipe Licyo', active: 'team', trail: [{ label: 'Équipe Licyo' }], content, status });
}

export const onRequestGet = (context) => render(context);

export async function onRequestPost(context) {
  const form = await context.request.formData();
  const action = String(form.get('action') || '');
  const me = context.data.operator;
  const db = context.env.DB;
  const values = { name: String(form.get('name') || ''), email: String(form.get('email') || ''), role: String(form.get('role') || '') };
  try {
    if (action === 'invite') {
      const invite = await inviteOperator(db, me, values);
      const url = `${new URL(context.request.url).origin}/platform/invitation/${invite.token}`;
      return render(context, { message: 'Invitation créée.', created: { name: invite.name, url } });
    }
    if (action === 'invite-revoke') {
      await revokeOperatorInvite(db, me, form.get('inviteId'));
      return render(context, { message: 'Invitation annulée.' });
    }
    if (action === 'disable' || action === 'enable') {
      await setOperatorStatus(db, me, form.get('operatorId'), action === 'disable' ? 'disabled' : 'active');
      return render(context, { message: action === 'disable' ? 'Compte désactivé, ses connexions sont fermées.' : 'Compte réactivé.' });
    }
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    return render(context, { error: error.message, values, status: 400 });
  }
  return render(context);
}
