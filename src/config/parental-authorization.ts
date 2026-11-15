// Autorisation parentale signée en ligne (apport du CRM d'ASC Muay Thai), pour chaque adhérent mineur.
//
// Le club choisit d'activer l'autorisation et peut adapter son texte (variables entre accolades). À l'inscription,
// le responsable légal indique son nom et sa qualité, lit le texte rendu pour chaque enfant, accepte et signe.
// Le SERVEUR rend le texte à partir des réglages du club (jamais le texte envoyé par le navigateur) et enregistre
// une copie figée : texte exact, signataire, qualité, date, empreinte du modèle. Une modification ultérieure du
// modèle par le club ne change donc jamais ce qui a été signé.
// Module pur, partagé navigateur/serveur ; testé dans tests/parental-authorization.test.ts.

export const SIGNER_QUALITIES = {
  mere: 'mère',
  pere: 'père',
  tuteur: 'tuteur ou tutrice légal(e)',
} as const;
export type SignerQuality = keyof typeof SIGNER_QUALITIES;
export const isSignerQuality = (v: unknown): v is SignerQuality => typeof v === 'string' && v in SIGNER_QUALITIES;

export const AUTHORIZATION_VARIABLES = {
  '{responsable}': 'nom du responsable légal',
  '{qualite}': 'mère, père ou tuteur',
  '{enfant}': 'prénom et nom de l’enfant',
  '{naissance}': 'date de naissance de l’enfant',
  '{club}': 'nom du club',
  '{sport}': 'sport du club',
  '{saison}': 'saison',
} as const;

export const DEFAULT_AUTHORIZATION_TEXT = `Je soussigné(e) {responsable}, agissant en qualité de {qualite} de {enfant}, né(e) le {naissance}, autorise mon enfant à pratiquer l'activité « {sport} » au sein du club {club} pour la saison {saison}.

J'autorise mon enfant à participer aux entraînements, stages, rencontres et compétitions organisés par le club, ainsi qu'aux déplacements nécessaires, encadrés par les éducateurs ou des bénévoles du club.

Je m'engage à informer le club de tout problème de santé ou de toute contre-indication à la pratique, et je reconnais avoir pris connaissance du règlement intérieur.`;

export const AUTHORIZATION_TEXT_MAX = 4000;

export type ParentalAuthorizationConfig = { enabled: boolean; text: string };

/** Réglage lu dans clubs.registration_form.parentalAuthorization. Activée par défaut, texte par défaut. */
export function parseParentalAuthorization(registrationForm: unknown): ParentalAuthorizationConfig {
  const form = registrationForm && typeof registrationForm === 'object' ? (registrationForm as Record<string, unknown>) : {};
  const raw = form.parentalAuthorization && typeof form.parentalAuthorization === 'object' ? (form.parentalAuthorization as Record<string, unknown>) : {};
  const text = typeof raw.text === 'string' ? raw.text.replace(/\r\n/g, '\n').trim() : '';
  return {
    enabled: raw.enabled !== false,
    text: text.length >= 40 && text.length <= AUTHORIZATION_TEXT_MAX ? text : DEFAULT_AUTHORIZATION_TEXT,
  };
}

export type AuthorizationVars = {
  signerName: string;
  signerQuality: SignerQuality;
  childName: string;
  birthDate: string; // AAAA-MM-JJ
  clubName: string;
  sport: string;
  season: string;
};

const frDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/** Texte rendu pour un enfant. Les valeurs sont insérées telles quelles (affichées comme texte, jamais en HTML). */
export function renderAuthorization(template: string, v: AuthorizationVars): string {
  const values: Record<keyof typeof AUTHORIZATION_VARIABLES, string> = {
    '{responsable}': v.signerName.trim() || '…',
    '{qualite}': SIGNER_QUALITIES[v.signerQuality],
    '{enfant}': v.childName.trim() || '…',
    '{naissance}': frDate(v.birthDate),
    '{club}': v.clubName,
    '{sport}': v.sport,
    '{saison}': v.season,
  };
  return template.replace(/\{(responsable|qualite|enfant|naissance|club|sport|saison)\}/g, (k) => values[k as keyof typeof values]);
}

/** Copie figée enregistrée sur l'adhérent (members.parental_authorization). */
export type SignedAuthorization = {
  text: string;
  signerName: string;
  signerQuality: SignerQuality;
  signedAt: string;
  /** Empreinte SHA-256 du modèle du club au moment de la signature. */
  templateHash: string;
  /** Où elle a été signée : à l'inscription, ou plus tard par le lien envoyé à la famille. */
  channel: 'inscription' | 'lien';
  /** Signature tracée sur le lien (à l'inscription, c'est celle du dossier : members.signature_data_url). */
  signatureDataUrl?: string;
};

export function parseSignedAuthorization(raw: unknown): SignedAuthorization | null {
  const o = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.text !== 'string' || typeof r.signerName !== 'string' || !isSignerQuality(r.signerQuality) || typeof r.signedAt !== 'string') return null;
  return {
    text: r.text,
    signerName: r.signerName,
    signerQuality: r.signerQuality,
    signedAt: r.signedAt,
    templateHash: typeof r.templateHash === 'string' ? r.templateHash : '',
    channel: r.channel === 'lien' ? 'lien' : 'inscription',
    signatureDataUrl: typeof r.signatureDataUrl === 'string' && r.signatureDataUrl.startsWith('data:image/png;base64,') ? r.signatureDataUrl : undefined,
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function templateHash(template: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(template));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Copie figée à enregistrer, rendue à partir du modèle du club (jamais du texte envoyé par le navigateur). */
export async function buildSignedAuthorization(
  template: string,
  vars: AuthorizationVars,
  opts: { now: Date; channel: SignedAuthorization['channel']; signatureDataUrl?: string },
): Promise<SignedAuthorization> {
  return {
    text: renderAuthorization(template, vars),
    signerName: vars.signerName.trim(),
    signerQuality: vars.signerQuality,
    signedAt: opts.now.toISOString(),
    templateHash: await templateHash(template),
    channel: opts.channel,
    ...(opts.signatureDataUrl ? { signatureDataUrl: opts.signatureDataUrl } : {}),
  };
}

/** L'adhérent attend-il une autorisation ? Mineur, saison en cours, dossier actif, pas encore signée. */
export function authorizationPending(
  m: { is_minor: boolean; anonymized_at: string | null; parental_authorization: unknown; season: string; dossier_status: string } | null,
  currentSeason: string,
): boolean {
  return Boolean(m && m.is_minor && !m.anonymized_at && !m.parental_authorization && m.season === currentSeason && m.dossier_status !== 'rejected');
}
