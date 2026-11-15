import type { DossierStatus } from '@/types/database';

/** Libellés et couleurs des statuts de dossier, partagés par les écrans du bureau. */
export const DOSSIER_STATUS: Record<DossierStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  pending_review: { label: 'À vérifier', tone: 'info' },
  needs_correction: { label: 'Correction demandée', tone: 'warning' },
  validated: { label: 'Validé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
  trial_requested: { label: 'Essai demandé', tone: 'neutral' },
  trial_done: { label: 'Essai fait', tone: 'neutral' },
};
