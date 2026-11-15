import { requireClubContext, createClient } from '@/lib/db/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { Badge, Card, CardBody } from '@/components/ui/card';

const KIND_LABELS: Record<string, string> = {
  inscription_recue: 'Inscription reçue',
  inscription_validee: 'Inscription validée',
  correction_demandee: 'Pièce à remplacer',
  convocation: 'Convocation',
  essai: 'Séance d’essai',
  reinscription: 'Réinscription',
  paiement_recu: 'Paiement reçu',
  test: 'Test d’envoi',
  autre: 'Autre',
};

const STATUS = {
  sent: { label: 'Envoyé', tone: 'success' },
  logged: { label: 'Non envoyé (domaine d’envoi à configurer)', tone: 'warning' },
  failed: { label: 'Échec', tone: 'danger' },
} as const;

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

type Props = { searchParams: Promise<{ q?: string; statut?: string }> };

/** Journal des e-mails du club : répondre à « je n'ai rien reçu » sans deviner. Conservé 13 mois. */
export default async function EmailLogPage({ searchParams }: Props) {
  const { club } = await requireClubContext(['members.read', 'communication.manage']);
  const { q = '', statut = '' } = await searchParams;
  const search = q.trim().toLowerCase().slice(0, 120);
  const db = await createClient();
  let query = db
    .from('email_log')
    .select('id, kind, recipient, subject, provider, status, error, created_at')
    .eq('club_id', club.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (search) query = query.eq('recipient', search);
  if (statut === 'sent' || statut === 'logged' || statut === 'failed') query = query.eq('status', statut);
  const { data: rows, error } = await query;
  if (error) throw new Error('Journal des e-mails indisponible');

  return (
    <>
      <PageHeader
        title="Journal des e-mails"
        description="Les 200 derniers e-mails envoyés au nom du club (conservés 13 mois). Le contenu n’est pas conservé."
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" method="get">
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="q">
          Adresse exacte du destinataire
          <input
            id="q"
            name="q"
            type="email"
            defaultValue={q}
            className="min-h-11 rounded-lg border bg-white px-3 text-base font-normal"
            placeholder="parent@exemple.fr"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="statut">
          Statut
          <select id="statut" name="statut" defaultValue={statut} className="min-h-11 rounded-lg border bg-white px-3 text-base font-normal">
            <option value="">Tous</option>
            <option value="sent">Envoyés</option>
            <option value="logged">Non envoyés</option>
            <option value="failed">Échecs</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-lg border bg-white px-4 font-medium">
          Filtrer
        </button>
      </form>
      <Card>
        {(rows ?? []).length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted-foreground">Aucun e-mail pour ces critères.</p>
          </CardBody>
        ) : (
          <ul className="divide-y">
            {(rows ?? []).map((r) => (
              <li key={r.id} className="grid gap-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  <span className="font-medium">{KIND_LABELS[r.kind] ?? r.kind}</span>
                  <span className="text-muted-foreground">{dateFmt.format(new Date(r.created_at))}</span>
                </div>
                <p className="break-words">
                  <span className="text-muted-foreground">À </span>
                  {r.recipient}
                </p>
                <p className="break-words text-muted-foreground">{r.subject}</p>
                {r.error ? <p className="break-words text-destructive">{r.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
