import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { loadClubOr404, sitePrefix } from '@/lib/tenant';
import { getSportPreset } from '@/config/sports-presets';
import { SlotFinderWidget } from '@/components/vitrine/SlotFinderWidget';
import { PlainText } from '@/components/vitrine/PageTitle';
import { formatEuros } from '@/lib/pricing';

export default async function ClubHomePage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const data = await loadClubOr404(domain);
  const { club, categories, posts, sponsors } = data;
  const { vocabulary: v, label } = getSportPreset(club.sport_type);
  const prefix = sitePrefix(domain);
  const minPrice = categories.length ? Math.min(...categories.map((c) => Number(c.annual_price))) : null;

  return (
    <>
      <section className="relative overflow-hidden bg-club-primary text-club-primary-fg">
        {club.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={club.hero_image_url} alt="" className="absolute inset-0 size-full object-cover opacity-30" fetchPriority="high" />
        ) : null}
        <div className="page-container relative py-14 md:py-24">
          <p className="text-sm font-semibold uppercase tracking-wider opacity-90">{label} à {club.city}</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-extrabold leading-tight md:text-5xl">{club.name}</h1>
          <p className="mt-3 max-w-xl text-lg opacity-95">{v.tagline}</p>
          {minPrice !== null ? <p className="mt-2 text-sm opacity-90">Cotisation à partir de {formatEuros(minPrice)} par an.</p> : null}
          <div className="mt-6 flex flex-wrap gap-3">
            {club.enabled_modules.inscriptions ? (
              <Link href={`${prefix}/inscription`} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-club-secondary px-6 font-semibold text-club-secondary-fg">
                S'inscrire en ligne <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : null}
            {club.enabled_modules.trials ? (
              <Link href={`${prefix}/essai`} className="inline-flex min-h-12 items-center rounded-lg border-2 border-current px-6 font-semibold">
                Séance d'essai gratuite
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <div className="page-container -mt-6 relative">
        <SlotFinderWidget
          categories={categories}
          schedules={data.schedules}
          facilities={data.facilities}
          vocab={v}
          prefix={prefix}
          trialsEnabled={club.enabled_modules.trials}
          registrationEnabled={club.enabled_modules.inscriptions}
        />
      </div>

      <div className="page-container mt-12 grid gap-10 md:grid-cols-2">
        {club.club_history_text ? (
          <section aria-labelledby="histoire">
            <h2 id="histoire" className="text-2xl font-bold">Le club</h2>
            <PlainText text={club.club_history_text} />
          </section>
        ) : null}
        {club.president_word_text ? (
          <section aria-labelledby="mot-president" className="rounded-2xl bg-muted p-5 md:p-6">
            <h2 id="mot-president" className="text-2xl font-bold">Le mot du président</h2>
            <PlainText text={club.president_word_text} />
            {club.president_name ? <p className="mt-2 font-semibold">{club.president_name}</p> : null}
          </section>
        ) : null}
      </div>

      {posts.length > 0 ? (
        <section aria-labelledby="actualites" className="page-container mt-12">
          <h2 id="actualites" className="text-2xl font-bold">Actualités</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-3">
            {posts.slice(0, 3).map((p) => (
              <li key={p.id}>
                <Link href={`${prefix}/actualites/${p.slug}`} className="flex h-full flex-col overflow-hidden rounded-xl border bg-white hover:shadow-md">
                  {p.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.cover_image_url} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                  ) : (
                    <div aria-hidden className="h-1.5 w-full bg-club-secondary" />
                  )}
                  <div className="flex flex-1 flex-col p-4">
                    <time className="text-xs text-muted-foreground" dateTime={p.published_at}>
                      {new Date(p.published_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </time>
                    <p className="mt-1 font-semibold">{p.title}</p>
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{p.content}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {club.enabled_modules.sponsors && sponsors.length > 0 ? (
        <section aria-labelledby="partenaires" className="page-container mt-12">
          <h2 id="partenaires" className="text-2xl font-bold">Ils nous soutiennent</h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-6">
            {sponsors.map((s) => (
              <li key={s.id} className="flex aspect-[3/2] items-center justify-center rounded-xl border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.logo_url} alt={s.company_name} loading="lazy" className="max-h-full max-w-full object-contain" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
