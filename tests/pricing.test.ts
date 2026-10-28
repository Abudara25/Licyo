import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStripeFees } from '../src/lib/stripe/fee-calculator.ts';
import { computeCart, splitInstallments } from '../src/lib/pricing.ts';
import { readableTextColor, safeHex } from '../src/lib/utils/color-contrast.ts';
import { ageOn, categoriesForBirthYear } from '../src/lib/age.ts';
import { signValue, verifyValue, signImpersonation, verifyImpersonation } from '../src/lib/utils/impersonation.ts';

test('frais Stripe : le club reçoit bien le net après commission', () => {
  for (const net of [1, 9.99, 50, 100, 160, 187.5, 333.33, 1000]) {
    const { totalWithFees, stripeFeeAdded } = computeStripeFees(net);
    const received = totalWithFees - (totalWithFees * 0.015 + 0.25);
    assert.ok(received >= net - 1e-9, `net ${net} : reçu ${received}`);
    assert.ok(received - net < 0.02, `net ${net} : surfacturation ${received - net}`);
    assert.equal(stripeFeeAdded, Number((totalWithFees - net).toFixed(2)));
  }
  assert.deepEqual(computeStripeFees(100), { totalWithFees: 101.78, stripeFeeAdded: 1.78 });
  assert.deepEqual(computeStripeFees(0), { totalWithFees: 0, stripeFeeAdded: 0 });
});

const rules = {
  siblingDiscount: {
    enabled: true,
    second_member_discount: 20,
    third_member_discount: 40,
    discount_type: 'fixed_euros' as const,
  },
  acceptsPassSport: true,
  passSportAmount: 50,
  passStripeFeesToParents: true,
};

test("panier fratrie : remises sur les licences les moins chères, Pass'Sport et frais carte", () => {
  const t = computeCart(
    [
      { licensePrice: 160, usesPassSport: false, products: [] },
      { licensePrice: 200, usesPassSport: true, products: [{ price: 25 }] },
      { licensePrice: 180, usesPassSport: false, products: [] },
    ],
    rules,
    true,
  );
  assert.equal(t.licensesSubtotal, 540);
  assert.equal(t.productsSubtotal, 25);
  assert.equal(t.siblingDiscountAmount, 60);
  assert.equal(t.aidsDeductionAmount, 50);
  assert.equal(t.netAmount, 455);
  const fees = computeStripeFees(455);
  assert.deepEqual([t.finalTotalAmount, t.stripeFeeAdded], [fees.totalWithFees, fees.stripeFeeAdded]);
});

test('panier : pas de frais hors carte, jamais de total négatif', () => {
  const cheque = computeCart([{ licensePrice: 30, usesPassSport: true, products: [] }], rules, false);
  assert.equal(cheque.aidsDeductionAmount, 30);
  assert.equal(cheque.finalTotalAmount, 0);
  assert.equal(cheque.stripeFeeAdded, 0);
});

test('échéancier au centime près', () => {
  assert.deepEqual(splitInstallments(100, 3), [33.34, 33.33, 33.33]);
  assert.equal(splitInstallments(455.5, 3).reduce((a, b) => a + b, 0).toFixed(2), '455.50');
});

test('contraste YIQ', () => {
  assert.equal(readableTextColor('#FBBF24'), '#09090B');
  assert.equal(readableTextColor('#1E40AF'), '#FFFFFF');
  assert.equal(safeHex('red'), '#1E40AF');
});

test('âge et catégories', () => {
  const ref = new Date('2026-09-01T00:00:00Z');
  assert.equal(ageOn('2008-09-01', ref), 18);
  assert.equal(ageOn('2008-09-02', ref), 17);
  const cats = [
    { min_birth_year: 2016, max_birth_year: 2018, gender_filter: 'mixed' },
    { min_birth_year: 2010, max_birth_year: 2015, gender_filter: 'F' },
  ];
  assert.equal(categoriesForBirthYear(cats, 2017).length, 1);
  assert.equal(categoriesForBirthYear(cats, 2012, 'M').length, 0);
  assert.equal(categoriesForBirthYear(cats, 2012, 'F').length, 1);
});

test('signature HMAC : valide, falsifiée, expirée, liée au bon super_admin', async () => {
  process.env.IMPERSONATION_SECRET_KEY = 'x'.repeat(40);
  const v = await signValue(['abc', 'def']);
  assert.deepEqual(await verifyValue(v, 2), ['abc', 'def']);
  assert.equal(await verifyValue(v.replace('abc', 'abd'), 2), null);
  assert.equal(await verifyValue(await signValue(['abc'], -10), 1), null);
  const cookie = await signImpersonation('club-1', 'admin-1');
  assert.equal(await verifyImpersonation(cookie, 'admin-1'), 'club-1');
  assert.equal(await verifyImpersonation(cookie, 'admin-2'), null);
});
