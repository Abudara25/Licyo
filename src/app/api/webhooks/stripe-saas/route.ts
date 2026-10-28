import { revalidateTag } from 'next/cache';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { clubTag } from '@/lib/tenant';
import { requireEnv } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Abonnements des clubs à la plateforme (Stripe Billing).
 * Signature vérifiée ; l'état est relu dans l'abonnement Stripe ; rejouable sans effet de bord.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Signature manquante', { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, requireEnv('STRIPE_WEBHOOK_SECRET_SAAS'));
  } catch {
    return new Response('Signature invalide', { status: 400 });
  }

  const admin = createAdminClient();

  async function syncSubscription(subscriptionId: string, fallbackClubId?: string) {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const clubId = sub.metadata.club_id || fallbackClubId;
    if (!clubId) return;
    const plan = sub.metadata.plan === 'vitrine' ? 'vitrine' : 'integral';
    const live = ['active', 'trialing', 'past_due'].includes(sub.status);
    const { data: club } = await admin
      .from('clubs')
      .update({
        stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        stripe_subscription_id: sub.id,
        subscription_plan: plan,
        status: live ? 'active' : 'suspended',
        demo_expires_at: null,
      })
      .eq('id', clubId)
      .select('slug')
      .maybeSingle();
    if (club) revalidateTag(clubTag(club.slug));
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        await syncSubscription(typeof session.subscription === 'string' ? session.subscription : session.subscription.id, session.metadata?.club_id ?? session.client_reference_id ?? undefined);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object.id);
      break;
    default:
      break;
  }
  return Response.json({ received: true });
}
