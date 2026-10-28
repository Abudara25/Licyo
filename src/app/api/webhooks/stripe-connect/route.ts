import { createElement } from 'react';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireEnv } from '@/lib/env';
import { formatEuros } from '@/lib/pricing';
import { todayIso } from '@/lib/season';
import { sendClubEmailSafely } from '@/lib/email/mailer';
import { PaymentReceivedEmail } from '@/lib/email/templates';

export const runtime = 'nodejs';

/**
 * Paiements des familles sur le compte Stripe du club (Connect).
 * - signature vérifiée avec le secret Connect ;
 * - session relue chez Stripe sur le compte émetteur : seul « paid » fait foi ;
 * - le dossier doit appartenir au club propriétaire du compte ;
 * - mise à jour conditionnelle (payment_status ≠ paid) : un événement rejoué ne compte pas deux fois.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Signature manquante', { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, requireEnv('STRIPE_WEBHOOK_SECRET_CONNECT'));
  } catch {
    return new Response('Signature invalide', { status: 400 });
  }
  const account = event.account;
  if (!account) return Response.json({ received: true });
  const admin = createAdminClient();

  if (event.type === 'account.updated') {
    await admin.from('clubs').update({ stripe_connect_onboarded: Boolean(event.data.object.charges_enabled) }).eq('stripe_connect_account_id', account);
    return Response.json({ received: true });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {}, { stripeAccount: account });
    if (session.payment_status !== 'paid' || session.mode !== 'payment') return Response.json({ received: true });

    const { data: club } = await admin.from('clubs').select('*').eq('stripe_connect_account_id', account).maybeSingle();
    if (!club) return Response.json({ received: true });
    const { data: family } = await admin
      .from('family_registrations')
      .select('*')
      .eq('stripe_checkout_session_id', session.id)
      .eq('club_id', club.id)
      .maybeSingle();
    if (!family) return Response.json({ received: true });

    const amount = (session.amount_total ?? 0) / 100;
    const { data: updated } = await admin
      .from('family_registrations')
      .update({ amount_paid: amount, payment_status: amount >= Number(family.final_total_amount) ? 'paid' : 'partial', payment_method: 'card' })
      .eq('id', family.id)
      .neq('payment_status', 'paid')
      .select('id');
    if (!updated?.length) return Response.json({ received: true }); // déjà traité

    await admin.from('payment_installments').insert({
      club_id: club.id,
      family_id: family.id,
      amount,
      payment_type: 'card',
      scheduled_deposit_date: todayIso(),
      status: 'cashed',
    });
    await sendClubEmailSafely({
      club,
      to: family.payer_email,
      subject: `Paiement reçu - ${club.name}`,
      reactComponent: createElement(PaymentReceivedEmail, {
        club,
        payerFirstName: family.payer_first_name,
        amount: formatEuros(amount),
        invoiceNumber: family.invoice_number ?? family.id.slice(0, 8),
      }),
    });
  }

  return Response.json({ received: true });
}
