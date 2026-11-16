// Horaires et lieux identiques pour le site, les e-mails et l'espace famille : source D1.
import { getPublicData, safeMapsUrl, buildMapsUrl } from './public-data.js';
import { getCategoriesConfig } from './settings-kv.js';
import { categoryForRow } from './inscriptions-db.js';

const hour = (value) => String(value).replace(/^(\d{2}):(\d{2})$/, (_, h, m) => `${Number(h)}h${m === '00' ? '' : m}`);
export async function clubPracticalInfo(env, row) {
  try {
    const config = await getCategoriesConfig(env, row.organization_id);
    const category = categoryForRow(config.categories, row);
    const data = await getPublicData(env, row.organization_id);
    const group = data.groups.find((g) => g.slug === category?.id);
    const slots = data.schedules.filter((s) => !s.group_id || s.group_id === group?.id);
    const location = data.locations.find((l) => l.id === slots[0]?.location_id) || (!slots.length ? null : data.locations[0]);
    return {
      schedule: slots.map((s) => `${s.weekday_label}, ${hour(s.start_time)} – ${hour(s.end_time)}${slots.length > 1 ? ` ${data.locations.find((l) => l.id === s.location_id)?.name || ''}`.trimEnd() : ''}`).join(' ; '),
      location: location ? [location.name, location.address].filter(Boolean).join(', ') : '',
      mapsUrl: location ? safeMapsUrl(location.maps_url) || buildMapsUrl(location.name, location.address) : '',
    };
  } catch {
    // Pas d'ancien horaire ressuscité : renvoyer vers la page pratique à jour.
    return { schedule: '', location: '', mapsUrl: '' };
  }
}
