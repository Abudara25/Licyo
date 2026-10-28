import { loadClubOr404 } from '@/lib/tenant';
import { DAY_LABELS, getSportPreset } from '@/config/sports-presets';
import { clubSiteUrl } from '@/lib/env';
import { formatEuros } from '@/lib/pricing';

/** Fiche Markdown destinée aux moteurs de réponse (ChatGPT, Perplexity…). */
export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const { club, categories, schedules, facilities, events } = await loadClubOr404(domain);
  const preset = getSportPreset(club.sport_type);
  const v = preset.vocabulary;
  const url = clubSiteUrl(club);
  const startYear = Number(club.current_season.slice(0, 4));
  const facilityName = (id: string | null) => facilities.find((f) => f.id === id)?.name ?? club.city;

  const lines = [
    `# ${club.name}`,
    '',
    `> Club de ${v.sportName} (${preset.label}) à ${club.city} (${club.postal_code}), France. Saison ${club.current_season}.`,
    '',
    '## Informations pratiques',
    `- Site : ${url}`,
    `- Contact : ${club.contact_email}${club.contact_phone ? `, ${club.contact_phone}` : ''}`,
    `- Communes desservies : ${[club.city, ...club.nearby_cities].join(', ')}`,
    club.federation_name ? `- Fédération : ${club.federation_name}` : '',
    `- Inscription en ligne : ${club.enabled_modules.inscriptions ? `${url}/inscription` : 'non'}`,
    `- Séance d'essai gratuite : ${club.enabled_modules.trials ? `${url}/essai` : 'sur demande'}`,
    club.accepts_pass_sport ? `- Pass'Sport accepté (${formatEuros(Number(club.pass_sport_amount))} de réduction)` : '',
    club.accepts_installments ? '- Paiement en plusieurs fois possible' : '',
    '',
    `## ${v.groups.charAt(0).toUpperCase() + v.groups.slice(1)} et tarifs`,
    ...categories.flatMap((c) => [
      `### ${c.name}`,
      `- Âges : ${startYear - c.max_birth_year} à ${startYear - c.min_birth_year} ans (né·es de ${c.min_birth_year} à ${c.max_birth_year})`,
      `- Tarif annuel : ${formatEuros(Number(c.annual_price))}`,
      ...schedules.filter((s) => s.category_id === c.id).map((s) => `- ${DAY_LABELS[s.day_of_week]} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)} (${facilityName(s.facility_id)})`),
      '',
    ]),
    `## ${v.venues.charAt(0).toUpperCase() + v.venues.slice(1)}`,
    ...facilities.map((f) => `- ${f.name} : ${f.address}, ${f.postal_code} ${f.city}`),
    '',
    '## Prochains rendez-vous',
    ...events
      .filter((e) => new Date(e.event_date) >= new Date())
      .slice(0, 10)
      .map((e) => `- ${new Date(e.event_date).toLocaleDateString('fr-FR')} : ${e.title}${e.location_text ? ` (${e.location_text})` : ''}`),
  ];

  return new Response(lines.filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
