import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient } from '@/lib/db/server';
import { CeAttestationPdf } from '@/lib/pdf/ce-attestation-pdf';
import { moduleEnabled } from '@/lib/platform';
export const runtime = 'nodejs';
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ familyId: string }> },
) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return new Response('Connexion requise', { status: 401 });
  const { familyId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(familyId))
    return new Response('Introuvable', { status: 404 });
  // Vérification explicite AVANT de lire les données du dossier : un identifiant ne donne aucun droit.
  const { data: access, error: accessError } = await db
    .from('family_access')
    .select('family_id,club_id')
    .eq('family_id', familyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (accessError || !access)
    return new Response('Accès refusé', { status: 403 });
  const { data: club } = await db
    .from('public_clubs')
    .select('*')
    .eq('id', access.club_id)
    .maybeSingle();
  if (!club || !moduleEnabled(club.enabled_modules, 'member_portal'))
    return new Response('Accès indisponible', { status: 403 });
  const { data: family } = await db
    .from('family_registrations')
    .select('*')
    .eq('id', familyId)
    .eq('club_id', access.club_id)
    .maybeSingle();
  if (!family) return new Response('Introuvable', { status: 404 });
  if (Number(family.amount_paid) <= 0)
    return new Response('Aucun paiement enregistré', { status: 409 });
  const [{ data: members }, { data: cats }] = await Promise.all([
    db
      .from('members')
      .select('first_name,last_name,birth_date,category_id')
      .eq('family_id', familyId)
      .eq('club_id', access.club_id)
      .neq('dossier_status', 'rejected'),
    db
      .from('categories')
      .select('id,name,annual_price')
      .eq('club_id', access.club_id),
  ]);
  const buffer = await renderToBuffer(
    createElement(CeAttestationPdf, {
      data: {
        club,
        family,
        members: (members ?? []).map((m) => ({
          fullName: m.first_name + ' ' + m.last_name,
          birthDate: m.birth_date,
          categoryName:
            cats?.find((c) => c.id === m.category_id)?.name ?? 'Groupe',
          licensePrice: Number(
            cats?.find((c) => c.id === m.category_id)?.annual_price ?? 0,
          ),
        })),
        issuedAt: new Date(),
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'attachment; filename="attestation-cotisation.pdf"',
      'Cache-Control': 'private, no-store',
    },
  });
}
