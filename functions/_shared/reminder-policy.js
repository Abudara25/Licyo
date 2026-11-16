// Même échéance dans les relances automatiques et la liste de travail du club.
import { familyHasActionPending } from './inscriptions-db.js';
import { isPartiallyPaid } from './payments.js';

export const REMIND_AFTER_DAYS = 3;
export const BALANCE_REMINDER_DAYS = 30;
export const REMINDER_DAYS = [3, 7];
const DAY = 86_400_000;
const time = (value) => value ? Date.parse(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`) : NaN;

// null = rien à relancer. Les relances manuelles restent possibles après les deux rappels automatiques.
export function reminderDueAt(row, { automatic = false } = {}) {
  if (row.archived_at || !familyHasActionPending(row)) return null;
  const count = Math.max(0, Number(row.auto_reminders_sent) || 0);
  if (automatic && count >= REMINDER_DAYS.length) return null;
  const created = time(row.created_at);
  const reminded = time(row.last_reminder_at);
  if (isPartiallyPaid(row)) {
    const paid = time(row.dernier_versement_at);
    // last_reminder_at sert aussi à dater le reçu du versement : le premier rappel part
    // bien de la date du paiement, même lorsqu'il a été saisi plusieurs jours plus tard.
    const since = count === 0 ? (Number.isFinite(paid) ? paid : created) : (Number.isFinite(reminded) ? reminded : paid);
    return Number.isFinite(since) ? since + BALANCE_REMINDER_DAYS * DAY : null;
  }
  if (!Number.isFinite(created)) return null;
  return Math.max(created + (automatic ? REMINDER_DAYS[count] : REMIND_AFTER_DAYS) * DAY,
    Number.isFinite(reminded) ? reminded + REMIND_AFTER_DAYS * DAY : -Infinity);
}
