/** Commission Stripe européenne appliquée aux paiements des clubs. */
export const STRIPE_PERCENT_FEE = 0.015;
export const STRIPE_FIXED_FEE = 0.25;

/**
 * Formule inversée : montant à faire payer pour que le club reçoive `netAmount`
 * après commission (1,5 % + 0,25 €).
 * Le `toFixed(6)` neutralise l'erreur flottante avant l'arrondi au centime supérieur
 * (sinon 10 177,000000001 centimes deviendrait 10 178).
 */
export function computeStripeFees(netAmount: number): { totalWithFees: number; stripeFeeAdded: number } {
  if (!Number.isFinite(netAmount) || netAmount <= 0) return { totalWithFees: 0, stripeFeeAdded: 0 };
  const raw = ((netAmount + STRIPE_FIXED_FEE) / (1 - STRIPE_PERCENT_FEE)) * 100;
  const totalWithFees = Math.ceil(Number(raw.toFixed(6))) / 100;
  const stripeFeeAdded = Number((totalWithFees - netAmount).toFixed(2));
  return { totalWithFees, stripeFeeAdded };
}

/** Convertit des euros en centimes entiers pour l'API Stripe. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
