import Link from 'next/link';
import { requireModule } from '@/lib/module-access';
import { createClient, requireClubContext } from '@/lib/db/server';
import { getDatabase } from '@/lib/db/d1';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { Badge, Card, CardBody } from '@/components/ui/card';
import { possibleDuplicates } from '@/lib/people';
import { DOSSIER_STATUS } from '@/lib/dossier-status';

type Props = { searchParams: Promise<{ q?: string; saison?: string }> };

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Adhérents du club, toutes saisons : une fiche par personne, avec sa dernière inscription. */
export default async function MembersDirectoryPage({ searchParams }: Props) {
  await requireModule('inscriptions');
  const { club } = await requireClubContext('members.read');
  const { q = '', saison = 'courante' } = await searchParams;
  const db = await createClient();
  const [{ data: people }, { data: members }, { data: categories }] = await Promise.all([
    db.from('people').select('id, first_name, last_name, birth_date').eq('club_id', club.id).order('last_name').limit(5000),
    db.from('members').select('person_id, season, dossier_status, category_id, created_at').eq('club_id', club.id).limit(20000),
    db.from('categories').select('id, name').eq('club_id', club.id),
  ]);
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const byPerson = new Map<string, NonNullable<typeof members>>();
  for (const m of members ?? []) {
    if (!m.person_id) continue;
    byPerson.set(m.person_id, [...(byPerson.get(m.person_id) ?? []), m]);
  }
  const needle = fold(q.trim());
  const rows = (people ?? [])
    .map((p) => {
      const seasons = (byPerson.get(p.id) ?? []).sort((a, b) => b.season.localeCompare(a.season) || b.created_at.localeCompare(a.created_at));
      return { ...p, latest: seasons[0], seasonCount: new Set(seasons.map((s) => s.season)).size, current: seasons.find((s) => s.season === club.current_season) };
    })
    .filter((p) => (saison === 'toutes' ? true : saison === 'anciens' ? !p.current : Boolean(p.current)))
    .filter((p) => !needle || fold(`${p.first_name} ${p.last_name}`).includes(needle));
  const duplicates = await possibleDuplicates(getDatabase(), club.id);

  return (
    <>
      <PageHeader title="Adhérents" description="Une fiche par personne, avec l’historique de toutes ses saisons." />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="q">
          Rechercher
          <input id="q" name="q" defaultValue={q} placeholder="Prénom ou nom" className="min-h-11 rounded-lg border bg-white px-3 text-base font-normal" />
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium" htmlFor="saison">
          Afficher
          <select id="saison" name="saison" defaultValue={saison} className="min-h-11 w-full min-w-0 rounded-lg border bg-white px-3 text-base font-normal">
            <option value="courante">Saison {club.current_season}</option>
            <option value="anciens">Anciens adhérents (non réinscrits)</option>
            <option value="toutes">Toutes les saisons</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-lg border bg-white px-4 font-medium">
          Afficher
        </button>
      </form>

      {duplicates.length ? (
        <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          {duplicates.length} ressemblance{duplicates.length > 1 ? 's' : ''} entre fiches à vérifier (doublon possible ou fratrie) : elles sont
          signalées sur les fiches concernées, rien n’est fusionné automatiquement.
        </p>
      ) : null}

      <Card>
        {rows.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted-foreground">Aucun adhérent pour ces critères.</p>
          </CardBody>
        ) : (
          <ul className="divide-y">
            {rows.slice(0, 500).map((p) => {
              const status = p.latest ? DOSSIER_STATUS[p.latest.dossier_status] : null;
              return (
                <li key={p.id}>
                  <Link href={`/club-admin/adherents/${p.id}`} className="grid min-h-11 gap-1 p-3 text-sm hover:bg-muted sm:grid-cols-[1fr_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="font-medium">
                        {p.first_name} {p.last_name}
                      </span>
                      <span className="block text-muted-foreground">
                        {p.latest ? `${p.latest.season} - ${p.latest.category_id ? (catName.get(p.latest.category_id) ?? 'Catégorie supprimée') : 'Sans catégorie'}` : 'Aucune inscription'}
                        {p.seasonCount > 1 ? ` - ${p.seasonCount} saisons` : ''}
                      </span>
                    </span>
                    {status ? <Badge tone={status.tone} className="justify-self-start sm:justify-self-end">{status.label}</Badge> : null}
                  </Link>
                </li>
              );
            })}
            {rows.length > 500 ? <li className="p-3 text-sm text-muted-foreground">… {rows.length - 500} autres : affinez la recherche.</li> : null}
          </ul>
        )}
      </Card>
    </>
  );
}
