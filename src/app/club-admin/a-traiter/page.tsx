import Link from 'next/link';
import { authorizationPending, parseParentalAuthorization } from '@/config/parental-authorization';
import { RequestAuthorizationButton } from '@/components/club-admin/RequestAuthorizationButton';
import { requireModule } from '@/lib/module-access';
import { can, createClient, requireClubContext } from '@/lib/db/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ReminderPolicyEditor } from '@/components/club-admin/ReminderPolicyEditor';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatEuros } from '@/lib/pricing';
import { clubDocuments, missingDocuments, parseReminderPolicy } from '@/lib/reminders';

const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'Europe/Paris' });

type Item = { id: string; title: string; detail: string; reminders?: string };

function Section({ title, description, items, href, linkLabel, empty }: { title: string; description: string; items: Item[]; href: string; linkLabel: string; empty: string }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title} <Badge tone={items.length ? 'warning' : 'success'}>{items.length}</Badge>
          </span>
        }
        description={description}
        action={
          items.length ? (
            <Link href={href} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium">
              {linkLabel}
            </Link>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted-foreground">{empty}</p>
        </CardBody>
      ) : (
        <ul className="divide-y">
          {items.slice(0, 50).map((i) => (
            <li key={i.id} className="grid gap-0.5 p-3 text-sm">
              <span className="font-medium">{i.title}</span>
              <span className="text-muted-foreground">{i.detail}</span>
              {i.reminders ? <span className="text-muted-foreground">{i.reminders}</span> : null}
            </li>
          ))}
          {items.length > 50 ? <li className="p-3 text-sm text-muted-foreground">… et {items.length - 50} autres.</li> : null}
        </ul>
      )}
    </Card>
  );
}

/** File « À traiter » : ce qui attend le bureau, et les relances automatiques déjà envoyées. */
export default async function ToDoPage() {
  await requireModule('inscriptions');
  const ctx = await requireClubContext('members.read');
  const { club } = ctx;
  const db = await createClient();
  const [{ data: members }, { data: categories }, { data: families }, { data: installments }, { data: logs }, { data: requests }] = await Promise.all([
    db
      .from('members')
      .select('id, first_name, last_name, dossier_status, photo_storage_path, medical_doc_storage_path, id_doc_storage_path, health_questionnaire_passed, is_minor, category_id, rejection_reason, created_at')
      .eq('club_id', club.id)
      .eq('season', club.current_season)
      .in('dossier_status', ['pending_review', 'needs_correction'])
      .order('created_at'),
    db.from('categories').select('id, name, medical_requirement').eq('club_id', club.id),
    db
      .from('family_registrations')
      .select('id, payer_first_name, payer_last_name, final_total_amount, amount_paid, payment_status, created_at')
      .eq('club_id', club.id)
      .eq('season', club.current_season)
      .in('payment_status', ['unpaid', 'partial']),
    db.from('payment_installments').select('family_id, amount, status').eq('club_id', club.id).in('status', ['pending', 'deposited']),
    db.from('reminder_log').select('target_id, kind, step, sent_at').eq('club_id', club.id).order('sent_at', { ascending: false }).limit(2000),
    db.from('preregistrations').select('id, status').eq('club_id', club.id).eq('season', club.current_season).in('status', ['waiting', 'expired']),
  ]);
  const cat = new Map((categories ?? []).map((c) => [c.id, c]));
  const documents = clubDocuments(club.registration_form, club.sport_type);
  const { data: extraDocs } = await db.from('member_documents').select('member_id, doc_key').eq('club_id', club.id);
  const extrasOf = (id: string) => new Set((extraDocs ?? []).filter((d) => d.member_id === id).map((d) => d.doc_key));
  const remindersOf = (id: string) => {
    const list = (logs ?? []).filter((l) => l.target_id === id);
    return list.length ? `${list.length} relance${list.length > 1 ? 's' : ''} envoyée${list.length > 1 ? 's' : ''}, la dernière le ${day.format(new Date(list[0].sent_at))}` : undefined;
  };

  const incomplete: Item[] = [];
  const toValidate: Item[] = [];
  const corrections: Item[] = [];
  for (const m of members ?? []) {
    const name = `${m.first_name} ${m.last_name}`;
    const category = m.category_id ? cat.get(m.category_id) : undefined;
    if (m.dossier_status === 'needs_correction') {
      corrections.push({ id: m.id, title: name, detail: m.rejection_reason ?? 'Pièce à remplacer', reminders: remindersOf(m.id) });
      continue;
    }
    const missing = missingDocuments({ ...m, medical_requirement: category?.medical_requirement ?? null }, documents, extrasOf(m.id));
    if (missing.length) {
      incomplete.push({ id: m.id, title: name, detail: `${category?.name ?? 'Sans catégorie'} - manque : ${missing.join(', ')}`, reminders: remindersOf(m.id) });
    } else {
      toValidate.push({ id: m.id, title: name, detail: `${category?.name ?? 'Sans catégorie'} - dossier reçu le ${day.format(new Date(m.created_at))}` });
    }
  }
  const scheduled = new Map<string, number>();
  for (const i of installments ?? []) scheduled.set(i.family_id, (scheduled.get(i.family_id) ?? 0) + Number(i.amount));
  const payments: Item[] = (families ?? []).flatMap((f) => {
    const due = Math.round((Number(f.final_total_amount) - Number(f.amount_paid) - (scheduled.get(f.id) ?? 0)) * 100) / 100;
    return due >= 1
      ? [{ id: f.id, title: `${f.payer_first_name} ${f.payer_last_name}`, detail: `Reste ${formatEuros(due)} sur ${formatEuros(Number(f.final_total_amount))}`, reminders: remindersOf(f.id) }]
      : [];
  });
  const waiting = (requests ?? []).filter((r) => r.status === 'waiting').length;
  const expired = (requests ?? []).filter((r) => r.status === 'expired').length;
  const policy = parseReminderPolicy(club.reminder_policy);
  const authorization = parseParentalAuthorization(club.registration_form);
  const { data: unsigned } = authorization.enabled
    ? await db
        .from('members')
        .select('id, first_name, last_name, person_id, dossier_status, registration_type, is_minor, season, anonymized_at, parental_authorization')
        .eq('club_id', club.id)
        .eq('season', club.current_season)
        .eq('is_minor', true)
        .is('parental_authorization', null)
        .order('last_name')
        .limit(300)
    : { data: [] };
  const missingAuthorizations: Item[] = (unsigned ?? [])
    .filter((m) => authorizationPending(m, club.current_season))
    .map((m) => ({ id: m.id, title: `${m.first_name} ${m.last_name}`, detail: m.registration_type === 'trial' ? 'Séance d’essai' : 'Inscrit sans autorisation en ligne' }));

  return (
    <>
      <PageHeader title="À traiter" description={`Saison ${club.current_season} - ce qui attend le bureau.`} />
      <div className="grid gap-6">
        {!policy.enabled && (incomplete.length || corrections.length || payments.length) ? (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Des dossiers attendent une action des familles et les relances automatiques sont désactivées : activez-les plus bas, ou relancez les
            familles vous-même.
          </p>
        ) : null}
        <Section title="Dossiers à valider" description="Dossiers complets en attente de vérification." items={toValidate} href="/club-admin/inscriptions" linkLabel="Valider" empty="Aucun dossier à valider." />
        <Section title="Dossiers incomplets" description="Pièces encore manquantes côté famille." items={incomplete} href="/club-admin/inscriptions" linkLabel="Voir les dossiers" empty="Aucun dossier incomplet." />
        <Section title="Corrections en attente" description="Pièces refusées, pas encore remplacées." items={corrections} href="/club-admin/inscriptions" linkLabel="Voir les dossiers" empty="Aucune correction en attente." />
        {can(ctx, 'finance.read') ? (
          <Section title="Paiements en attente" description="Reste à payer, hors chèques déjà remis." items={payments} href="/club-admin/tresorerie" linkLabel="Trésorerie" empty="Aucun paiement en attente." />
        ) : null}
        {authorization.enabled ? (
          <div className="grid gap-2">
            <Section
              title="Autorisations parentales à signer"
              description="Mineurs de la saison sans autorisation signée en ligne (inscrits avant son activation, séances d’essai, dossiers saisis par le bureau)."
              items={missingAuthorizations}
              href="/club-admin/adherents"
              linkLabel="Adhérents"
              empty="Toutes les autorisations sont signées."
            />
            {missingAuthorizations.length && can(ctx, 'members.write') ? (
              <div>
                <RequestAuthorizationButton label={`Demander aux familles (${missingAuthorizations.length})`} />
              </div>
            ) : null}
          </div>
        ) : null}
        <Section
          title="Liste d’attente"
          description="Demandes à inviter dès qu’une place se libère."
          items={waiting || expired ? [{ id: 'w', title: `${waiting} demande${waiting > 1 ? 's' : ''} en attente`, detail: expired ? `${expired} lien${expired > 1 ? 's' : ''} expiré${expired > 1 ? 's' : ''} à réinviter ou retirer` : 'Aucun lien expiré' }] : []}
          href="/club-admin/preinscriptions"
          linkLabel="Pré-inscriptions"
          empty="Personne en liste d’attente."
        />
        <ReminderPolicyEditor initial={policy} canEdit={can(ctx, 'settings.manage')} />
      </div>
    </>
  );
}
