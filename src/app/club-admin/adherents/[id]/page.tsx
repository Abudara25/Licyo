import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireModule } from '@/lib/module-access';
import { can, createClient, requireClubContext } from '@/lib/db/server';
import { getDatabase } from '@/lib/db/d1';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { PersonNotes } from '@/components/club-admin/PersonNotes';
import { PersonalDataPanel } from '@/components/club-admin/PersonalDataPanel';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { describeAnswers, parseFormConfig } from '@/config/registration-fields';
import { ageOn } from '@/lib/age';
import { DOSSIER_STATUS } from '@/lib/dossier-status';
import { DUPLICATE_LABELS, possibleDuplicates } from '@/lib/people';
import { formatEuros } from '@/lib/pricing';
import { REMINDER_KIND_LABELS, clubDocuments, missingDocuments } from '@/lib/reminders';
import { documentLabel, parseDocumentsConfig } from '@/config/registration-documents';
import { SIGNER_QUALITIES, parseSignedAuthorization } from '@/config/parental-authorization';

type Props = { params: Promise<{ id: string }> };

const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'Europe/Paris' });
const PAYMENT: Record<string, string> = { unpaid: 'Non réglé', partial: 'Partiel', paid: 'Réglé', refunded: 'Remboursé' };

/** Fiche d'une personne : identité, toutes ses saisons, et ce que le club lui a envoyé. */
export default async function PersonPage({ params }: Props) {
  await requireModule('inscriptions');
  const ctx = await requireClubContext('members.read');
  const { club } = ctx;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const { data: person } = await db.from('people').select('*').eq('id', id).eq('club_id', club.id).maybeSingle();
  if (!person) notFound();

  const [{ data: seasons }, { data: categories }] = await Promise.all([
    db.from('members').select('*').eq('club_id', club.id).eq('person_id', id).order('season', { ascending: false }),
    db.from('categories').select('id, name').eq('club_id', club.id),
  ]);
  const memberRows = seasons ?? [];
  const familyIds = [...new Set(memberRows.map((m) => m.family_id).filter((x): x is string => Boolean(x)))];
  const canFinance = can(ctx, 'finance.read');
  const [{ data: families }, { data: reminders }] = await Promise.all([
    familyIds.length
      ? db.from('family_registrations').select('id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, final_total_amount, amount_paid, payment_status').in('id', familyIds)
      : Promise.resolve({ data: [] as never[] }),
    db
      .from('reminder_log')
      .select('target_id, kind, step, sent_at')
      .eq('club_id', club.id)
      .in('target_id', [...memberRows.map((m) => m.id), ...familyIds])
      .order('sent_at', { ascending: false }),
  ]);
  const emails = [...new Set((families ?? []).map((f) => f.payer_email.toLowerCase()))];
  const { data: sent } = emails.length
    ? await db.from('email_log').select('kind, recipient, subject, status, created_at').eq('club_id', club.id).in('recipient', emails).order('created_at', { ascending: false }).limit(30)
    : { data: [] as never[] };
  const duplicates = await possibleDuplicates(getDatabase(), club.id, id);
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const famById = new Map((families ?? []).map((f) => [f.id, f]));
  const form = parseFormConfig(club.registration_form);
  const docsConfig = parseDocumentsConfig(club.registration_form);
  const documents = clubDocuments(club.registration_form, club.sport_type);
  const { data: extraDocs } = memberRows.length
    ? await db.from('member_documents').select('member_id, doc_key').in('member_id', memberRows.map((m) => m.id))
    : { data: [] as { member_id: string; doc_key: string }[] };
  const { data: medicalOf } = await db.from('categories').select('id, medical_requirement').eq('club_id', club.id);
  const latestFamily = memberRows.map((m) => (m.family_id ? famById.get(m.family_id) : undefined)).find(Boolean);
  const age = ageOn(person.birth_date);

  return (
    <>
      <PageHeader
        title={`${person.first_name} ${person.last_name}`}
        description={`Né(e) le ${day.format(new Date(person.birth_date))} (${age} ans) - ${memberRows.length} inscription${memberRows.length > 1 ? 's' : ''}`}
        actions={
          <Link href="/club-admin/adherents" className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium">
            Tous les adhérents
          </Link>
        }
      />
      <div className="grid gap-6">
        {duplicates.length ? (
          <Card className="border-amber-300">
            <CardHeader title="À vérifier : fiches qui se ressemblent" description="Rien n’est fusionné automatiquement. Vérifiez s’il s’agit de la même personne." />
            <ul className="divide-y">
              {duplicates.map((d) => {
                const otherId = d.a === id ? d.b : d.a;
                const otherName = d.a === id ? d.bName : d.aName;
                const otherBirth = d.a === id ? d.bBirth : d.aBirth;
                return (
                  <li key={otherId} className="p-3 text-sm">
                    <Link className="font-medium underline" href={`/club-admin/adherents/${otherId}`}>
                      {otherName}
                    </Link>{' '}
                    <span className="text-muted-foreground">né(e) le {day.format(new Date(otherBirth))}</span>
                    <span className="block text-muted-foreground">{DUPLICATE_LABELS[d.reason]}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {latestFamily ? (
          <Card>
            <CardHeader title={age >= 18 ? 'Coordonnées' : 'Responsable légal'} description={`D’après l’inscription ${latestFamily.season}`} />
            <CardBody className="grid gap-1 text-sm">
              <p className="font-medium">
                {latestFamily.payer_first_name} {latestFamily.payer_last_name}
              </p>
              <p className="break-words">
                <a className="underline" href={`mailto:${latestFamily.payer_email}`}>{latestFamily.payer_email}</a> -{' '}
                <a className="underline" href={`tel:${latestFamily.payer_phone.replace(/\s/g, '')}`}>{latestFamily.payer_phone}</a>
              </p>
              <p className="text-muted-foreground">
                Urgence : {latestFamily.emergency_contact_name} - {latestFamily.emergency_contact_phone}
              </p>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="Saisons" />
          {memberRows.length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted-foreground">Aucune inscription rattachée.</p>
            </CardBody>
          ) : (
            <ul className="divide-y">
              {memberRows.map((m) => {
                const fam = m.family_id ? famById.get(m.family_id) : undefined;
                const answers = describeAnswers(form, m.extra_fields);
                const sentReminders = (reminders ?? []).filter((r) => r.target_id === m.id || r.target_id === m.family_id);
                return (
                  <li key={m.id} className="grid gap-2 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.season}</span>
                      <span>{m.category_id ? (catName.get(m.category_id) ?? 'Catégorie supprimée') : 'Sans catégorie'}</span>
                      <Badge tone={DOSSIER_STATUS[m.dossier_status].tone}>{DOSSIER_STATUS[m.dossier_status].label}</Badge>
                      {m.registration_type === 'renewal' ? <Badge tone="neutral">Réinscription</Badge> : null}
                    </div>
                    {(() => {
                      const extras = new Set((extraDocs ?? []).filter((d) => d.member_id === m.id).map((d) => d.doc_key));
                      const requirement = (medicalOf ?? []).find((c) => c.id === m.category_id)?.medical_requirement ?? null;
                      const missing = missingDocuments({ ...m, medical_requirement: requirement }, documents, extras);
                      const given = [
                        m.photo_storage_path ? 'photo' : null,
                        m.medical_doc_storage_path ? 'certificat' : null,
                        m.id_doc_storage_path ? 'pièce d’identité' : null,
                        ...[...extras].map((k) => documentLabel(docsConfig, k).toLowerCase()),
                      ].filter(Boolean);
                      return (
                        <p className="text-muted-foreground">
                          Pièces fournies : {given.length ? given.join(', ') : 'aucune'}
                          {m.season === club.current_season && missing.length ? ` - manque : ${missing.join(', ')}` : ''} - droit à l’image{' '}
                          {m.consent_image_rights ? 'accordé' : 'refusé'}
                        </p>
                      );
                    })()}
                    {m.is_minor ? (
                      (() => {
                        const a = parseSignedAuthorization(m.parental_authorization);
                        return a ? (
                          <p className="text-muted-foreground">
                            Autorisation parentale signée le {day.format(new Date(a.signedAt))} par {a.signerName} ({SIGNER_QUALITIES[a.signerQuality]}) -{' '}
                            <Link href={`/club-admin/adherents/${id}/autorisation/${m.id}`} className="inline-flex min-h-11 items-center font-medium text-foreground underline">
                              voir et imprimer
                            </Link>
                          </p>
                        ) : (
                          <p className="text-muted-foreground">Autorisation parentale : non signée en ligne pour cette saison.</p>
                        );
                      })()
                    ) : null}
                    {canFinance && fam ? (
                      <p className="text-muted-foreground">
                        Règlement famille : {PAYMENT[fam.payment_status] ?? fam.payment_status} - {formatEuros(Number(fam.amount_paid))} sur{' '}
                        {formatEuros(Number(fam.final_total_amount))}
                      </p>
                    ) : null}
                    {answers.length ? (
                      <dl className="grid gap-1 sm:grid-cols-2">
                        {answers.map((a) => (
                          <div key={a.label}>
                            <dt className="font-medium">{a.label}</dt>
                            <dd className="whitespace-pre-line break-words text-muted-foreground">{a.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {sentReminders.length ? (
                      <p className="text-muted-foreground">
                        Relances :{' '}
                        {sentReminders.map((r) => `${REMINDER_KIND_LABELS[r.kind]} n° ${r.step} le ${day.format(new Date(r.sent_at))}`).join(' ; ')}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="E-mails envoyés à la famille" description="Les 30 derniers, toutes saisons." />
          {(sent ?? []).length === 0 ? (
            <CardBody>
              <p className="text-sm text-muted-foreground">Aucun e-mail enregistré.</p>
            </CardBody>
          ) : (
            <ul className="divide-y">
              {(sent ?? []).map((e, i) => (
                <li key={i} className="grid gap-0.5 p-3 text-sm">
                  <span className="break-words">{e.subject}</span>
                  <span className="text-muted-foreground">
                    {day.format(new Date(e.created_at))} - {e.status === 'sent' ? 'envoyé' : e.status === 'logged' ? 'non envoyé (domaine à configurer)' : 'échec'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <PersonNotes personId={id} initial={person.notes ?? ''} canEdit={can(ctx, 'members.write')} />
        {can(ctx, 'club.admin') ? <PersonalDataPanel personId={id} name={`${person.first_name} ${person.last_name}`} /> : null}
      </div>
    </>
  );
}
