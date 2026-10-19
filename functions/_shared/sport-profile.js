// Profil sportif du club (2026-10-20) : Licyo vise tous les sports, mais le code d'origine parlait de football (licence
// FFF, plateforme Footclubs, « École de foot »). Plutôt que d'éparpiller des conditions, ces mots restent les formes
// de RÉFÉRENCE dans les gabarits, et sont traduits au dernier moment selon le profil du club :
//   - pages HTML de l'admin (functions/_shared/admin-access.js) ;
//   - e-mails, au point d'envoi unique (brevoSend, confirmation-email.js).
// Le contenu public (sites/<club>/) est propre à chaque club et n'est pas traduit.
//
// Profil = préréglage du sport + champs modifiables par le club dans /admin/parametres (KV org:<club>:sport_profile).
// Les noms de plateformes fédérales sont indicatifs : chaque club peut les corriger.
import { readSetting, writeSetting } from './settings-kv.js';
import { DEMO_ORG_ID } from './schema.js';

export const SPORT_PRESETS = Object.freeze({
  football: { label: 'Football', federation: 'FFF', federationName: 'Fédération Française de Football', platform: 'Footclubs', tagline: 'École de foot', equipment: 'Taille de maillot' },
  basketball: { label: 'Basket-ball', federation: 'FFBB', federationName: 'Fédération Française de Basket-Ball', platform: 'e-Licence', tagline: 'École de basket', equipment: 'Taille de maillot' },
  handball: { label: 'Handball', federation: 'FFHandball', federationName: 'Fédération Française de Handball', platform: 'Gest’Hand', tagline: 'École de hand', equipment: 'Taille de maillot' },
  rugby: { label: 'Rugby', federation: 'FFR', federationName: 'Fédération Française de Rugby', platform: 'Oval-e', tagline: 'École de rugby', equipment: 'Taille de maillot' },
  volley: { label: 'Volley-ball', federation: 'FFVolley', federationName: 'Fédération Française de Volley', platform: '', tagline: 'École de volley', equipment: 'Taille de maillot' },
  judo: { label: 'Judo', federation: 'FFJDA', federationName: 'Fédération Française de Judo, Jujitsu, Kendo et Disciplines Associées', platform: '', tagline: 'Club de judo', equipment: 'Taille du judogi' },
  karate: { label: 'Karaté', federation: 'FFK', federationName: 'Fédération Française de Karaté et Disciplines Associées', platform: '', tagline: 'Club de karaté', equipment: 'Taille du kimono' },
  boxe: { label: 'Boxe anglaise', federation: 'FFBoxe', federationName: 'Fédération Française de Boxe', platform: '', tagline: 'Club de boxe', equipment: '' },
  muaythai: { label: 'Muay thaï, kick-boxing', federation: 'FFKMDA', federationName: 'Fédération Française de Kick Boxing, Muaythaï et Disciplines Associées', platform: '', tagline: 'Club de muay thaï', equipment: '' },
  natation: { label: 'Natation', federation: 'FFN', federationName: 'Fédération Française de Natation', platform: 'extraNat', tagline: 'Club de natation', equipment: '' },
  tennis: { label: 'Tennis', federation: 'FFT', federationName: 'Fédération Française de Tennis', platform: 'Ten’Up', tagline: 'École de tennis', equipment: '' },
  gymnastique: { label: 'Gymnastique', federation: 'FFGym', federationName: 'Fédération Française de Gymnastique', platform: '', tagline: 'Club de gymnastique', equipment: 'Taille du justaucorps' },
  athletisme: { label: 'Athlétisme', federation: 'FFA', federationName: 'Fédération Française d’Athlétisme', platform: 'SI-FFA', tagline: 'Club d’athlétisme', equipment: '' },
  autre: { label: 'Autre sport', federation: '', federationName: '', platform: '', tagline: 'Club sportif', equipment: '' },
});

export const SPORT_KEYS = Object.keys(SPORT_PRESETS);
const FIELDS = ['federation', 'federationName', 'platform', 'tagline', 'equipment'];
const LIMITS = { federation: 20, federationName: 120, platform: 60, tagline: 60, equipment: 60 };

// Profil complet d'un club. Sans réglage : football pour le club de démo (son contenu d'origine), « autre » pour
// tout autre club (aucune fédération supposée).
export async function getSportProfile(env, organizationId) {
  let stored = null;
  try {
    const raw = await readSetting(env, organizationId, 'sport_profile');
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  const sport = SPORT_KEYS.includes(stored?.sport) ? stored.sport : organizationId === DEMO_ORG_ID ? 'football' : 'autre';
  const profile = { sport, ...SPORT_PRESETS[sport] };
  for (const field of FIELDS) if (typeof stored?.[field] === 'string') profile[field] = stored[field];
  return profile;
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// Enregistre le sport et les champs modifiés. Un champ vide reprend la valeur du préréglage (rien n'est figé).
export async function setSportProfile(env, organizationId, input) {
  const sport = SPORT_KEYS.includes(input?.sport) ? input.sport : 'autre';
  const stored = { sport };
  for (const field of FIELDS) {
    const value = clean(input?.[field], LIMITS[field]);
    if (value && value !== SPORT_PRESETS[sport][field]) stored[field] = value;
  }
  await writeSetting(env, organizationId, 'sport_profile', JSON.stringify(stored));
  return getSportProfile(env, organizationId);
}

const isFootballIdentity = (p) =>
  p.federation === 'FFF' && p.federationName === SPORT_PRESETS.football.federationName && p.platform === 'Footclubs' && p.tagline === 'École de foot';

// Traduit les formes de référence (football) d'un texte selon le profil. Ordre : des expressions les plus longues aux
// plus courtes, pour ne jamais remplacer deux fois. `html` : le texte est du HTML (valeurs déjà sans < >, échappement
// de & et des guillemets inutile pour ces mots ; les apostrophes typographiques sont conservées).
export function applySportVocabulary(text, profile) {
  if (!text || !profile || isFootballIdentity(profile)) return text;
  const fed = profile.federation;
  const fedName = profile.federationName;
  const fedFull = fed && fedName ? `${fedName} (${fed})` : fedName || fed || 'fédération';
  const platformPhrase = profile.platform ? `la plateforme ${profile.platform}` : 'l’espace en ligne de la fédération';
  const platform = profile.platform || 'l’espace en ligne de la fédération';
  return String(text)
    .replaceAll('Fédération Française de Football (FFF)', fedFull)
    .replaceAll('Fédération Française de Football', fedName || 'fédération')
    .replaceAll('la plateforme Footclubs', platformPhrase)
    .replaceAll('Footclubs', platform)
    .replaceAll('École de foot', profile.tagline || 'Club sportif')
    .replaceAll('de la FFF', fed ? `de la ${fed}` : 'de la fédération')
    .replaceAll('la FFF', fed ? `la ${fed}` : 'la fédération')
    .replace(/ FFF\b/g, fed ? ` ${fed}` : '')
    .replace(/\bFFF\b/g, fed || 'fédération');
}
