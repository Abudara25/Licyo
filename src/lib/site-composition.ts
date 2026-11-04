export const SITE_SECTIONS = [
  { id: 'hero', label: 'Accueil et invitation' },
  { id: 'numbers', label: 'Le club en quelques repères' },
  { id: 'practice', label: 'Groupes et créneaux' },
  { id: 'story', label: 'Histoire et mot du club' },
  { id: 'events', label: 'Prochains événements' },
  { id: 'news', label: 'Actualités' },
  { id: 'sponsors', label: 'Partenaires' },
] as const;
export type SiteSectionId = (typeof SITE_SECTIONS)[number]['id'];
export const DEFAULT_SECTIONS: SiteSectionId[] = SITE_SECTIONS.map((s) => s.id);
export function validSections(value: unknown): value is SiteSectionId[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= SITE_SECTIONS.length &&
    value.includes('hero') &&
    new Set(value).size === value.length &&
    value.every((id) => SITE_SECTIONS.some((s) => s.id === id))
  );
}
export function resolveSections(value: unknown): SiteSectionId[] {
  return validSections(value) ? value : DEFAULT_SECTIONS;
}
