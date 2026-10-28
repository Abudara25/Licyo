/** Saison suivante : « 2026-2027 » → « 2027-2028 ». */
export function nextSeason(season: string): string {
  const start = Number(season.slice(0, 4));
  return `${start + 1}-${start + 2}`;
}

export function previousSeason(season: string): string {
  const start = Number(season.slice(0, 4));
  return `${start - 1}-${start}`;
}

/** Date du jour au format AAAA-MM-JJ (fuseau Europe/Paris). */
export function todayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
}

/**
 * Dates de dépôt des chèques différés : le 5 octobre, novembre, décembre de la
 * saison ; si la date est passée, on décale au mois suivant aujourd'hui.
 */
export function installmentDates(season: string, count: number, today = todayIso()): string[] {
  const startYear = Number(season.slice(0, 4));
  const dates: string[] = [];
  let year = startYear;
  let month = 10;
  const [ty, tm, td] = today.split('-').map(Number);
  while (year < ty || (year === ty && (month < tm || (month === tm && td > 5)))) {
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  for (let i = 0; i < count; i++) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-05`);
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return dates;
}

export function invoiceNumber(season: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .toUpperCase()
    .slice(0, 6);
  return `ADH-${season.slice(0, 4)}-${rand}`;
}
