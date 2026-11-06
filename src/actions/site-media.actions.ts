"use server";

import { revalidateTag, revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getClubContext } from "@/lib/supabase/server";
import { MEDIA_SECTIONS, stockPhoto } from "@/lib/site-media";
import { clubTag } from "@/lib/tenant";
import type { ActionResult } from "@/lib/validation";

const choiceSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("stock"), id: z.string().regex(/^\d{1,12}$/) }),
    z.object({ kind: z.literal("club"), id: z.string().uuid() }),
  ])
  .nullable();

export async function saveSiteImage(
  section: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx || !["president", "secretary", "super_admin"].includes(ctx.role)) {
    return { ok: false, error: "Accès réservé à la direction du club." };
  }
  const parsed = choiceSchema.safeParse(input);
  if (!MEDIA_SECTIONS.some(({ id }) => id === section) || !parsed.success) {
    return { ok: false, error: "Sélection invalide." };
  }
  const choice = parsed.data;
  if (choice?.kind === "stock" && !stockPhoto(choice.id)) {
    return { ok: false, error: "Cette image n’est plus disponible." };
  }
  const db = await createClient();
  const { error } = choice
    ? await db.from("club_site_media").upsert(
        {
          club_id: ctx.club.id,
          section,
          stock_id: choice.kind === "stock" ? choice.id : null,
          photo_id: choice.kind === "club" ? choice.id : null,
        },
        { onConflict: "club_id,section" },
      )
    : await db
        .from("club_site_media")
        .delete()
        .eq("club_id", ctx.club.id)
        .eq("section", section);
  if (error)
    return {
      ok: false,
      error:
        "Impossible de publier cette image. Vérifiez qu’elle est toujours disponible.",
    };

  revalidateTag(clubTag(ctx.club.slug));
  revalidatePath("/club-admin/modules");
  return { ok: true, message: "Image de la vitrine mise à jour." };
}
