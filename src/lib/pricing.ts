import type { SiblingDiscountRules } from '../types/database';
import { computeStripeFees } from './stripe/fee-calculator.ts';

export type CartMember = {
  licensePrice: number;
  usesPassSport: boolean;
  products: { price: number }[];
};

export type CartRules = {
  siblingDiscount: SiblingDiscountRules;
  acceptsPassSport: boolean;
  passSportAmount: number;
  passStripeFeesToParents: boolean;
};

export type CartTotals = {
  licensesSubtotal: number;
  productsSubtotal: number;
  siblingDiscountAmount: number;
  aidsDeductionAmount: number;
  netAmount: number;
  stripeFeeAdded: number;
  finalTotalAmount: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Calcul unique du panier, utilisé à l'affichage ET recalculé côté serveur
 * avant toute écriture : le navigateur n'impose jamais un montant.
 * - Fratrie : la remise s'applique aux licences les moins chères (2e, puis 3e et suivants).
 * - Pass'Sport : déduit par membre éligible, jamais au-delà du prix de sa licence.
 * - Frais Stripe : ajoutés seulement pour un paiement par carte si le club les répercute.
 */
export function computeCart(members: CartMember[], rules: CartRules, paymentByCard: boolean): CartTotals {
  const licensesSubtotal = round2(members.reduce((s, m) => s + m.licensePrice, 0));
  const productsSubtotal = round2(members.reduce((s, m) => s + m.products.reduce((p, x) => p + x.price, 0), 0));

  let siblingDiscountAmount = 0;
  const rule = rules.siblingDiscount;
  if (rule?.enabled && members.length > 1) {
    const sorted = [...members].sort((a, b) => b.licensePrice - a.licensePrice);
    sorted.forEach((m, index) => {
      if (index === 0) return;
      const value = index === 1 ? rule.second_member_discount : rule.third_member_discount;
      const discount = rule.discount_type === 'percent' ? (m.licensePrice * value) / 100 : value;
      siblingDiscountAmount += Math.min(Math.max(discount, 0), m.licensePrice);
    });
  }
  siblingDiscountAmount = round2(siblingDiscountAmount);

  let aidsDeductionAmount = 0;
  if (rules.acceptsPassSport) {
    for (const m of members) if (m.usesPassSport) aidsDeductionAmount += Math.min(rules.passSportAmount, m.licensePrice);
  }
  aidsDeductionAmount = round2(Math.min(aidsDeductionAmount, licensesSubtotal - siblingDiscountAmount));

  const netAmount = round2(
    Math.max(0, licensesSubtotal + productsSubtotal - siblingDiscountAmount - aidsDeductionAmount),
  );
  const fees = paymentByCard && rules.passStripeFeesToParents ? computeStripeFees(netAmount) : null;
  return {
    licensesSubtotal,
    productsSubtotal,
    siblingDiscountAmount,
    aidsDeductionAmount,
    netAmount,
    stripeFeeAdded: fees?.stripeFeeAdded ?? 0,
    finalTotalAmount: fees?.totalWithFees ?? netAmount,
  };
}

/** Répartit un montant en N échéances au centime près (le reste sur la première). */
export function splitInstallments(total: number, count: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + (cents - base * count) : base) / 100);
}

export function formatEuros(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}
