// Libellés et tons des états. Les trois états d'une organisation restent DISTINCTS (baseline, ADR-003) :
// cycle de vie (contrat), facturation (miroir du prestataire) et mode d'accès (projection dérivée).
export const LIFECYCLE = {
  PROVISIONING: { label: 'Provisionnement', tone: 'info' },
  TRIAL: { label: 'Essai', tone: 'violet' },
  LIVE: { label: 'Actif', tone: 'success' },
  TERMINATION_SCHEDULED: { label: 'Résiliation planifiée', tone: 'warning' },
  TERMINATED: { label: 'Résilié', tone: 'neutral' },
  ARCHIVED: { label: 'Archivé', tone: 'neutral' },
  PURGE_SCHEDULED: { label: 'Purge planifiée', tone: 'danger' },
};

export const BILLING = {
  MANUAL: { label: 'Manuelle', tone: 'neutral' },
  NONE: { label: 'Aucune', tone: 'neutral' },
  TRIALING: { label: 'Essai', tone: 'violet' },
  ACTIVE: { label: 'À jour', tone: 'success' },
  PAST_DUE: { label: 'Impayé · grâce', tone: 'warning' },
  UNPAID: { label: 'Impayé', tone: 'danger' },
  CANCELED: { label: 'Annulé', tone: 'neutral' },
};

export const ACCESS = {
  FULL: { label: 'Accès complet', tone: 'success' },
  SETUP: { label: 'Configuration', tone: 'info' },
  READ_ONLY: { label: 'Lecture seule', tone: 'warning' },
  MAINTENANCE: { label: 'Maintenance', tone: 'violet' },
  BLOCKED: { label: 'Bloqué', tone: 'danger' },
};

export const HEALTH = {
  healthy: { label: 'Sain' },
  warning: { label: 'Attention' },
  incident: { label: 'Incident' },
};

export const DOMAIN_STATUS = {
  ACTIVE: { label: 'Vérifié', tone: 'success' },
  CHALLENGE_ISSUED: { label: 'DNS en attente', tone: 'warning' },
  PROVISIONING: { label: 'Provisionnement', tone: 'info' },
  QUARANTINED: { label: 'Quarantaine', tone: 'violet' },
  PROVISIONING_FAILED: { label: 'Erreur', tone: 'danger' },
};

export const SSL = {
  active: { label: 'Actif', tone: 'success' },
  pending: { label: 'En cours', tone: 'info' },
  failed: { label: 'Échec', tone: 'danger' },
  none: { label: '—', tone: 'neutral' },
};

export const SERVICE_STATUS = {
  operational: { label: 'Opérationnel', tone: 'success' },
  degraded: { label: 'Dégradé', tone: 'warning' },
  outage: { label: 'Panne', tone: 'danger' },
  planned: { label: 'Non activé', tone: 'neutral' },
};

export const INCIDENT_STATUS = {
  investigating: { label: 'Investigation', tone: 'danger' },
  identified: { label: 'Cause identifiée', tone: 'warning' },
  monitoring: { label: 'Surveillance', tone: 'info' },
  resolved: { label: 'Résolu', tone: 'success' },
};

export const SEVERITY = {
  SEV1: { label: 'SEV-1', tone: 'danger' },
  SEV2: { label: 'SEV-2', tone: 'warning' },
  SEV3: { label: 'SEV-3', tone: 'neutral' },
};

export const PRIORITY = {
  urgent: { label: 'Urgente', tone: 'danger', rank: 0 },
  high: { label: 'Haute', tone: 'warning', rank: 1 },
  normal: { label: 'Normale', tone: 'info', rank: 2 },
  low: { label: 'Basse', tone: 'neutral', rank: 3 },
};

export const TICKET_STATUS = {
  new: { label: 'Nouveau', tone: 'info' },
  open: { label: 'En cours', tone: 'violet' },
  waiting: { label: 'Attente client', tone: 'warning' },
  resolved: { label: 'Résolu', tone: 'success' },
};

export const AUDIT_RESULT = {
  success: { label: 'Succès', tone: 'success' },
  denied: { label: 'Refusé', tone: 'danger' },
  failed: { label: 'Échec', tone: 'warning' },
};

export const CAPABILITY = {
  shipped: { label: 'Livrée', tone: 'success' },
  beta: { label: 'Bêta', tone: 'info' },
  in_development: { label: 'Non livrée', tone: 'neutral' },
};

export const SPORTS = {
  football: { label: 'Football', color: '#16a34a' },
  tennis: { label: 'Tennis', color: '#ca8a04' },
  padel: { label: 'Padel', color: '#0891b2' },
  judo: { label: 'Judo', color: '#7c3aed' },
  karate: { label: 'Karaté', color: '#9333ea' },
  natation: { label: 'Natation', color: '#0284c7' },
  athletisme: { label: 'Athlétisme', color: '#ea580c' },
  basket: { label: 'Basket', color: '#dc2626' },
  rugby: { label: 'Rugby', color: '#65a30d' },
  danse: { label: 'Danse', color: '#db2777' },
  badminton: { label: 'Badminton', color: '#0d9488' },
  escrime: { label: 'Escrime', color: '#475569' },
  volley: { label: 'Volley', color: '#d97706' },
};

export const statusOf = (map, key) => map[key] ?? { label: key ?? '—', tone: 'neutral' };
