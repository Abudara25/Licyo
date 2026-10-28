import 'server-only';
import Stripe from 'stripe';
import { requireEnv } from '@/lib/env';

let instance: Stripe | null = null;

/** Instance Stripe serveur (créée à la première utilisation, pas au build). */
export function getStripe(): Stripe {
  instance ??= new Stripe(requireEnv('STRIPE_SECRET_KEY'), { appInfo: { name: 'Licyo' } });
  return instance;
}

export function priceIdForPlan(plan: 'vitrine' | 'integral'): string {
  return requireEnv(plan === 'vitrine' ? 'STRIPE_PRICE_ID_VITRINE' : 'STRIPE_PRICE_ID_INTEGRAL');
}

/** Tarifs affichés sur la page publique ; les montants facturés viennent des Price Stripe. */
export const PLANS = {
  vitrine: { name: 'Vitrine', monthly: 19, features: ['Site vitrine aux couleurs du club', 'Planning, équipes et résultats', 'Actualités et partenaires', 'Sous-domaine ou domaine personnalisé'] },
  integral: { name: 'Intégral', monthly: 49, features: ['Tout le pack Vitrine', 'Inscriptions en ligne et paiement', 'Validation des dossiers en 1 clic', 'Feuilles d\'appel hors ligne', 'Attestations et bilan AG en PDF', 'Convocations et e-mails depuis l\'adresse du club'] },
} as const;
