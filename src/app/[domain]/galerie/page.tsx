import { notFound } from 'next/navigation';
import { loadClubOr404 } from '@/lib/tenant';
import { createPublicClient } from '@/lib/db/public';
import { moduleEnabled } from '@/lib/platform';
import { PageTitle } from '@/components/vitrine/PageTitle';
export default async function Gallery({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { club } = await loadClubOr404((await params).domain);
  if (!moduleEnabled(club.enabled_modules, 'gallery')) notFound();
  const { data, error } = await createPublicClient()
    .from('club_gallery')
    .select('*')
    .eq('club_id', club.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Galerie indisponible');
  return (
    <>
      <PageTitle title="La vie du club en images" />
      <div className="page-container py-10">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data?.map((p) => (
            <figure key={p.id}>
              <img
                src={p.image_url}
                alt={p.title}
                width={600}
                height={400}
                loading="lazy"
                className="aspect-video w-full rounded-xl object-cover"
              />
              <figcaption className="mt-3 text-sm">{p.title}</figcaption>
            </figure>
          ))}
        </div>
        {!data?.length ? <p>Les premières photos arrivent bientôt.</p> : null}
      </div>
    </>
  );
}
