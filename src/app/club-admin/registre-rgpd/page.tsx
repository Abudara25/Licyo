import Link from 'next/link';
import { createClient, requireClubContext } from '@/lib/db/server';
import { getDatabase } from '@/lib/db/d1';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { PrintButton } from '@/components/club-admin/PrintButton';
import { getSportPreset } from '@/config/sports-presets';
import { parseFormConfig, resolveForm } from '@/config/registration-fields';
import { parseDocumentsConfig, resolveDocuments } from '@/config/registration-documents';
import { parseParentalAuthorization } from '@/config/parental-authorization';
import { ROLE_LABELS, effectiveGrants, grantsCan, type AnyStaffRole, type Permission } from '@/lib/permissions';
import { parseRetentionPolicy } from '@/lib/retention';
import { getConnection } from '@/lib/helloasso-connection';
import { buildRegister } from '@/lib/processing-register';

const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });

/** Registre des activités de traitement (RGPD, art. 30), pré-rempli à partir des réglages du club. Imprimable. */
export default async function ProcessingRegisterPage() {
  const { club } = await requireClubContext('club.admin');
  const db = await createClient();
  const [{ data: staff }, { data: categories }, helloAsso] = await Promise.all([
    db.from('staff_members').select('role, permissions').eq('club_id', club.id),
    db.from('categories').select('medical_requirement').eq('club_id', club.id),
    getConnection(getDatabase(), club.id),
  ]);
  const preset = getSportPreset(club.sport_type);
  const count = (p: Permission) => {
    const out: Record<string, number> = {};
    for (const s of staff ?? []) {
      if (s.role === 'super_admin' || !grantsCan(effectiveGrants(s.role as AnyStaffRole, s.permissions), p)) continue;
      const label = ROLE_LABELS[s.role as AnyStaffRole];
      out[label] = (out[label] ?? 0) + 1;
    }
    return out;
  };
  const register = buildRegister({
    club: {
      name: club.name,
      city: club.city,
      postalCode: club.postal_code,
      contactEmail: club.contact_email,
      presidentName: club.president_name,
      rnaNumber: club.rna_number,
      siretNumber: club.siret_number,
      sportLabel: preset.label,
      modules: club.enabled_modules,
      emailProvider: club.email_provider,
      stripeConnected: club.stripe_connect_onboarded,
    },
    formFields: resolveForm(parseFormConfig(club.registration_form), club.sport_type, preset.family).map((f) => f.label),
    documents: resolveDocuments(parseDocumentsConfig(club.registration_form), preset.family).map((d) => d.label),
    medicalCertificate: (categories ?? []).length > 0,
    parentalAuthorization: parseParentalAuthorization(club.registration_form).enabled,
    retention: parseRetentionPolicy(club.retention_policy),
    access: {
      members: count('members.read'),
      finance: count('finance.read'),
      communication: count('communication.manage'),
      coaches: (staff ?? []).filter((s) => s.role === 'coach').length,
    },
    helloAsso: Boolean(helloAsso),
    newsletter: true,
  });

  return (
    <>
      <style>{'@media print { .app-topbar, .app-sidebar, .app-nav, [data-print-hide] { display: none !important; } main { padding: 0 !important; } section { break-inside: avoid; } }'}</style>
      <div data-print-hide>
        <PageHeader
          title="Registre des traitements"
          description="Pré-rempli par Licyo à partir de vos réglages. Relisez-le, complétez-le et gardez-le à jour : c’est le document que la CNIL peut demander au club."
          actions={
            <Link href="/club-admin/parametres" className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium">
              Paramètres
            </Link>
          }
        />
        <div className="mb-6">
          <PrintButton />
        </div>
      </div>
      <article className="grid gap-6 text-sm leading-6">
        <section className="grid gap-1 rounded-xl border bg-white p-5">
          <h2 className="text-lg font-bold">Registre des activités de traitement - {register.controller.name}</h2>
          <p className="text-muted-foreground">Établi le {day.format(new Date())} (article 30 du RGPD).</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-4">
            <dt className="font-medium">Responsable du traitement</dt>
            <dd>{register.controller.name}</dd>
            <dt className="font-medium">Représentant</dt>
            <dd>{register.controller.representative}</dd>
            <dt className="font-medium">Identifiants</dt>
            <dd>{register.controller.identifiers}</dd>
            <dt className="font-medium">Adresse</dt>
            <dd>{register.controller.address}</dd>
            <dt className="font-medium">Contact</dt>
            <dd className="break-all">{register.controller.contact}</dd>
          </dl>
        </section>

        {register.activities.map((a, i) => (
          <section key={a.title} className="grid gap-2 rounded-xl border bg-white p-5">
            <h3 className="text-base font-bold">
              {i + 1}. {a.title}
            </h3>
            <dl className="grid gap-2 sm:grid-cols-[11rem_1fr] sm:gap-x-4">
              <dt className="font-medium">Finalité</dt>
              <dd>{a.purpose}</dd>
              <dt className="font-medium">Base légale</dt>
              <dd>{a.legalBasis}</dd>
              <dt className="font-medium">Personnes concernées</dt>
              <dd>{a.people.join(' ; ')}</dd>
              <dt className="font-medium">Données</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {a.data.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </dd>
              {a.sensitive ? (
                <>
                  <dt className="font-medium">Données sensibles</dt>
                  <dd>{a.sensitive}</dd>
                </>
              ) : null}
              <dt className="font-medium">Destinataires</dt>
              <dd>{a.recipients.join(' ')}</dd>
              <dt className="font-medium">Durée de conservation</dt>
              <dd>{a.retention}</dd>
            </dl>
          </section>
        ))}

        <section className="grid gap-2 rounded-xl border bg-white p-5">
          <h3 className="text-base font-bold">Sous-traitants</h3>
          <ul className="grid gap-1">
            {register.processors.map((p) => (
              <li key={p.name}>
                <span className="font-medium">{p.name}</span> - {p.role}. {p.location}.
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{register.transfers}</p>
        </section>

        <section className="grid gap-2 rounded-xl border bg-white p-5">
          <h3 className="text-base font-bold">Mesures de sécurité</h3>
          <ul className="list-disc pl-5">
            {register.security.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>

        <section className="grid gap-2 rounded-xl border bg-white p-5">
          <h3 className="text-base font-bold">Droits des personnes</h3>
          <ul className="list-disc pl-5">
            {register.rights.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      </article>
    </>
  );
}
