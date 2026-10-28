/** Âge révolu à une date de référence (aujourd'hui par défaut). */
export function ageOn(birthDate: string | Date, reference: Date = new Date()): number {
  const b = typeof birthDate === 'string' ? new Date(`${birthDate.slice(0, 10)}T00:00:00Z`) : birthDate;
  if (Number.isNaN(b.getTime())) return Number.NaN;
  let age = reference.getUTCFullYear() - b.getUTCFullYear();
  const m = reference.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && reference.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function isAdult(birthDate: string | Date, reference: Date = new Date()): boolean {
  return ageOn(birthDate, reference) >= 18;
}

/** Catégories dont la tranche d'années de naissance contient l'année donnée. */
export function categoriesForBirthYear<
  T extends { min_birth_year: number; max_birth_year: number; gender_filter?: string },
>(categories: T[], birthYear: number, gender?: 'M' | 'F' | 'X'): T[] {
  return categories.filter(
    (c) =>
      birthYear >= c.min_birth_year &&
      birthYear <= c.max_birth_year &&
      (!gender || gender === 'X' || !c.gender_filter || c.gender_filter === 'mixed' || c.gender_filter === gender),
  );
}
