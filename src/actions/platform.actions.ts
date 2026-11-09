"use server";
import { validSections } from "@/lib/site-composition";
import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import {
  createClient,
  getAuthContext,
  getClubContext,
} from "@/lib/db/server";
import { createAdminClient } from "@/lib/db/admin";
import {
  MODULES,
  SITE_TEMPLATES,
  tierForMembers,
  type SiteTemplate,
} from "@/lib/platform";
import { clubTag } from "@/lib/tenant";
import { getStripe } from "@/lib/stripe/client";
import { appUrl } from "@/lib/env";
import { firstError, slugSchema, type ActionResult } from "@/lib/validation";

export async function provisionClub(
  input: unknown,
): Promise<ActionResult<{ clubId: string }>> {
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      slug: slugSchema,
      sport: z.string().trim().min(2).max(80),
      city: z.string().trim().min(1).max(80),
      postalCode: z.string().regex(/^\d{5}$/),
      ownerName: z.string().trim().min(2).max(80),
      memberCount: z.coerce.number().int().min(0).max(1000000),
      template: z.custom<SiteTemplate>(
        (value) => SITE_TEMPLATES.some(({ id }) => id === value),
        "Modèle inconnu.",
      ),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const db = await createClient();
  const { data, error } = await db.rpc<string>("provision_club", {
    payload: parsed.data,
  });
  if (error || !data)
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "Cette adresse est déjà utilisée. Choisissez-en une autre."
          : "Création indisponible. Vérifiez votre connexion et la configuration de Licyo.",
    };
  (await cookies()).set("active_club", data, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/club-admin");
  return { ok: true, data: { clubId: data } };
}
export async function saveClubModules(
  settings: Record<string, boolean>,
  template: string,
): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx || !["president", "secretary", "super_admin"].includes(ctx.role))
    return { ok: false, error: "Accès réservé à la direction du club." };
  if (!SITE_TEMPLATES.some((t) => t.id === template))
    return { ok: false, error: "Modèle inconnu." };
  const clean: Record<string, boolean> = { vitrine: true };
  for (const m of MODULES) {
    if (typeof settings[m.id] !== "boolean")
      return { ok: false, error: "Réglages incomplets." };
    clean[m.id] = settings[m.id];
  }
  const { error } = await (
    await createClient()
  )
    .from("clubs")
    .update({
      enabled_modules: clean as import("@/types/database").EnabledModules,
      theme_preset: template,
    })
    .eq("id", ctx.club.id);
  if (error) return { ok: false, error: "Enregistrement impossible." };
  await createAdminClient().from("audit_events").insert({
    club_id: ctx.club.id,
    actor_id: ctx.auth.userId,
    action: "club.modules.updated",
    object_id: ctx.club.id,
  });
  revalidateTag(clubTag(ctx.club.slug));
  revalidatePath("/club-admin", "layout");
  return { ok: true, message: "Votre site et vos modules sont à jour." };
}
const tierSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(2).max(80),
  min_members: z.number().int().min(0).max(1000000),
  max_members: z.number().int().min(0).max(1000000).nullable(),
  monthly_cents: z.number().int().min(0).max(10000000).nullable(),
  stripe_price_id: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .nullable(),
  is_active: z.boolean(),
});
export async function saveMembershipTiers(
  input: unknown,
): Promise<ActionResult> {
  const auth = await getAuthContext();
  if (!auth?.isSuperAdmin)
    return { ok: false, error: "Accès réservé à Licyo." };
  const parsed = z.array(tierSchema).min(1).max(20).safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const sorted = parsed.data
    .filter((t) => t.is_active)
    .sort((a, b) => a.min_members - b.min_members);
  if (
    !sorted.length ||
    sorted[0].min_members !== 0 ||
    sorted[sorted.length - 1].max_members !== null
  )
    return {
      ok: false,
      error:
        "Les tranches actives doivent couvrir tous les effectifs, de 0 à une dernière tranche sans plafond.",
    };
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (
      (t.max_members !== null && t.max_members < t.min_members) ||
      (i > 0 && sorted[i - 1].max_members !== t.min_members - 1)
    )
      return {
        ok: false,
        error: "Les tranches doivent se suivre sans trou ni chevauchement.",
      };
    if (t.stripe_price_id) {
      try {
        const price = await getStripe().prices.retrieve(t.stripe_price_id);
        if (
          !price.active ||
          price.currency !== "eur" ||
          price.recurring?.interval !== "month" ||
          price.recurring.interval_count !== 1 ||
          price.unit_amount !== t.monthly_cents
        )
          return {
            ok: false,
            error:
              "Le prix Stripe doit correspondre exactement au montant mensuel en euros.",
          };
      } catch {
        return {
          ok: false,
          error:
            "Impossible de vérifier le prix Stripe. Le tarif peut être enregistré sans référence Stripe.",
        };
      }
    }
  }
  const { error } = await createAdminClient()
    .from("membership_tiers")
    .upsert(parsed.data);
  if (error)
    return { ok: false, error: "La grille ne peut pas être enregistrée." };
  await createAdminClient()
    .from("audit_events")
    .insert({ actor_id: auth.userId, action: "pricing.updated" });
  revalidatePath("/tarifs");
  revalidatePath("/super-admin/offres");
  return { ok: true, message: "Grille enregistrée." };
}
export async function startMembershipCheckout(): Promise<
  ActionResult<{ url: string }>
> {
  const ctx = await getClubContext();
  if (!ctx || !["president", "treasurer", "super_admin"].includes(ctx.role))
    return {
      ok: false,
      error: "Accès réservé à la direction et à la trésorerie.",
    };
  if (ctx.club.stripe_subscription_id)
    return {
      ok: false,
      error:
        "Un abonnement existe déjà. Utilisez le portail de facturation pour le gérer.",
    };
  const db = createAdminClient();
  const [{ data: tiers, error: tiersError }, { count, error: countError }] =
    await Promise.all([
      db.from("membership_tiers").select("*").eq("is_active", true),
      db
        .from("members")
        .select("id", { head: true, count: "exact" })
        .eq("club_id", ctx.club.id)
        .eq("season", ctx.club.current_season)
        .not("dossier_status", "in", "(rejected,trial_requested,trial_done)"),
    ]);
  if (tiersError || countError)
    return {
      ok: false,
      error: "Impossible de vérifier votre effectif et le tarif. Réessayez.",
    };
  const tier = tierForMembers(
    tiers ?? [],
    Math.max(ctx.club.declared_member_count, count ?? 0),
  );
  if (!tier || tier.monthly_cents === null || !tier.stripe_price_id)
    return {
      ok: false,
      error:
        "Le tarif de votre effectif n’est pas encore ouvert à la souscription. Contactez Licyo.",
    };
  try {
    const price = await getStripe().prices.retrieve(tier.stripe_price_id);
    if (
      price.unit_amount !== tier.monthly_cents ||
      price.currency !== "eur" ||
      !price.active ||
      price.recurring?.interval !== "month"
    )
      return { ok: false, error: "Tarif en cours de configuration." };
    const session = await getStripe().checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
        ...(ctx.club.stripe_customer_id
          ? { customer: ctx.club.stripe_customer_id }
          : { customer_email: ctx.auth.email }),
        client_reference_id: ctx.club.id,
        metadata: { club_id: ctx.club.id, tier_id: tier.id },
        subscription_data: {
          metadata: {
            club_id: ctx.club.id,
            tier_id: tier.id,
            plan: "integral",
          },
        },
        success_url: appUrl() + "/club-admin/parametres?abonnement=ok",
        cancel_url: appUrl() + "/club-admin/parametres",
      },
      {
        idempotencyKey:
          "membership-" +
          ctx.club.id +
          "-" +
          tier.id +
          "-" +
          Math.floor(Date.now() / 600000),
      },
    );
    return { ok: true, data: { url: session.url! } };
  } catch {
    return {
      ok: false,
      error: "La souscription est temporairement indisponible.",
    };
  }
}

export async function updateDeclaredCount(
  value: number,
): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx || !["president", "treasurer", "super_admin"].includes(ctx.role))
    return {
      ok: false,
      error: "Accès réservé à la direction et à la trésorerie.",
    };
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000)
    return { ok: false, error: "Effectif invalide." };
  const db = createAdminClient();
  const { count, error: countError } = await db
    .from("members")
    .select("id", { head: true, count: "exact" })
    .eq("club_id", ctx.club.id)
    .eq("season", ctx.club.current_season)
    .not("dossier_status", "in", "(rejected,trial_requested,trial_done)");
  if (countError)
    return { ok: false, error: "Impossible de vérifier l’effectif." };
  if (value < (count ?? 0))
    return {
      ok: false,
      error:
        "L’effectif déclaré ne peut pas être inférieur aux inscriptions enregistrées.",
    };
  const { error } = await db
    .from("clubs")
    .update({ declared_member_count: value })
    .eq("id", ctx.club.id);
  if (error) return { ok: false, error: "Mise à jour impossible." };
  await db.from("audit_events").insert({
    club_id: ctx.club.id,
    actor_id: ctx.auth.userId,
    action: "club.member_count.updated",
    object_id: ctx.club.id,
  });
  revalidatePath("/club-admin/parametres");
  return {
    ok: true,
    message: "Effectif mis à jour. Votre prélèvement reste inchangé.",
  };
}

export async function saveSiteComposition(
  input: unknown,
): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx || !["president", "secretary", "super_admin"].includes(ctx.role))
    return { ok: false, error: "Accès réservé à la direction du club." };
  if (!validSections(input))
    return {
      ok: false,
      error:
        "Composition invalide. Conservez l’accueil, sans section en double.",
    };
  const { error } = await (
    await createClient()
  )
    .from("club_site_settings")
    .upsert({ club_id: ctx.club.id, sections: input });
  if (error)
    return { ok: false, error: "La composition ne peut pas être enregistrée." };
  revalidateTag(clubTag(ctx.club.slug));
  revalidatePath("/club-admin/modules");
  return { ok: true, message: "Composition du site enregistrée." };
}
