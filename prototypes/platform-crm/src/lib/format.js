// Formats français. « Maintenant » est FIGÉ : le prototype affiche toujours le même état (captures reproductibles).
export const NOW = new Date('2026-09-28T09:30:00Z');

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const numberFmt = new Intl.NumberFormat('fr-FR');
const euroFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
export const formatNumber = (n) => (n === null || n === undefined ? '—' : numberFmt.format(n));
export const formatEuros = (cents) => euroFmt.format(Math.round(cents / 100));

export function formatStorage(mb) {
  if (mb < 1024) return `${numberFmt.format(Math.round(mb))} Mo`;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(mb / 1024)} Go`;
}

// « il y a 3 h », « dans 7 j »
export function relative(iso, now = NOW) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const unit =
    minutes < 1 ? 'à l’instant'
    : minutes < 60 ? `${minutes} min`
    : minutes < 60 * 24 ? `${Math.round(minutes / 60)} h`
    : minutes < 60 * 24 * 45 ? `${Math.round(minutes / 1440)} j`
    : `${Math.round(minutes / 43200)} mois`;
  if (unit === 'à l’instant') return unit;
  return diff < 0 ? `il y a ${unit}` : `dans ${unit}`;
}

// Identifiant opaque abrégé pour l'affichage (valeur complète dans l'infobulle et la copie).
export const shortId = (id) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

// Comparaison insensible à la casse et aux accents.
export const fold = (value) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
