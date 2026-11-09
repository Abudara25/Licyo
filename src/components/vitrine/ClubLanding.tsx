import { resolveSections, type SiteSectionId } from "@/lib/site-composition";
import type { SiteImage } from "@/lib/site-media";
import { ClubHero } from "./ClubHero";
import { LivingSite } from "./LivingSite";
import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { moduleEnabled } from "@/lib/platform";
import { getSportPreset } from "@/config/sports-presets";
import { SlotFinderWidget } from "./SlotFinderWidget";
import { PlainText } from "./PageTitle";
import type { PublicClubData } from "@/lib/tenant";
function PhotoCredit({ image }: { image?: SiteImage }) {
  if (!image?.source) return null;
  return (
    <a
      className="site-photo-credit"
      href={image.source}
      target="_blank"
      rel="noreferrer"
    >
      Photo d’illustration · {image.credit}
    </a>
  );
}

export function ClubLanding({
  data,
  prefix = "",
  preview = false,
  sections,
}: {
  data: PublicClubData;
  prefix?: string;
  preview?: boolean;
  sections?: string[];
}) {
  const { club, categories, posts, events, siteImages } = data;
  const visibleSections = resolveSections(sections ?? data.siteSections);
  const v = getSportPreset(club.sport_type).vocabulary;
  const blocks: Record<SiteSectionId, React.ReactNode> = {
    hero: (
      <ClubHero
        data={data}
        prefix={prefix}
        preview={preview}
        sections={visibleSections}
      />
    ),
    numbers: (
      <div className="page-container">
        <div className="club-stat-strip">
          <div>
            <strong>{club.current_season}</strong>
            <span>Une nouvelle saison à partager</span>
          </div>
          <div>
            <strong>{categories.length}</strong>
            <span>{v.groups} pour progresser</span>
          </div>
          <div>
            <strong>{club.city}</strong>
            <span>Un club près de chez vous</span>
          </div>
        </div>
      </div>
    ),
    practice: (
      <section className="page-container section-space">
        <div className="section-intro">
          <div>
            <span className="eyebrow">TROUVEZ VOTRE PLACE</span>
            <h2>À chacun sa pratique.</h2>
          </div>
          <p>Découvrez les groupes et les créneaux qui vous correspondent.</p>
        </div>
        <SlotFinderWidget
          categories={categories}
          schedules={data.schedules}
          facilities={data.facilities}
          vocab={v}
          prefix={preview ? "/decouvrir/site" : prefix}
          trialsEnabled={
            !preview && moduleEnabled(club.enabled_modules, "trials")
          }
          registrationEnabled={
            !preview && moduleEnabled(club.enabled_modules, "inscriptions")
          }
        />
      </section>
    ),
    story:
      club.club_history_text || club.president_word_text ? (
        <section className="templates-section">
          <div className="page-container section-space grid gap-10 md:grid-cols-2">
            <div>
              <span className="eyebrow">NOTRE HISTOIRE</span>
              <h2 className="mt-4 text-3xl font-semibold">
                Bien plus qu’un club.
              </h2>
              <PlainText text={club.club_history_text ?? ""} />
            </div>
            <div className="workspace-card">
              <span className="eyebrow">UN MOT POUR VOUS</span>
              <PlainText text={club.president_word_text ?? ""} />
              {club.president_name ? (
                <p className="mt-4 text-sm font-semibold">
                  {club.president_name}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null,
    events:
      moduleEnabled(club.enabled_modules, "events") && events.length ? (
        <section className="page-container section-space">
          <div className="section-intro">
            <div>
              <span className="eyebrow">À VOS AGENDAS</span>
              <h2>Les prochains temps forts.</h2>
            </div>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {events.slice(0, 4).map((e) => (
              <article className="workspace-card" key={e.id}>
                <span className="eyebrow">
                  <CalendarDays size={16} />
                  {new Date(e.event_date).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    timeZone: "Europe/Paris",
                  })}
                </span>
                <h3 className="mt-4 text-xl font-semibold">{e.title}</h3>
                <p>{e.location_text ?? club.city}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null,
    news:
      moduleEnabled(club.enabled_modules, "news") && posts.length ? (
        <section className="page-container pb-16">
          <div className="section-intro">
            <div>
              <span className="eyebrow">LE CLUB EN MOUVEMENT</span>
              <h2>Notre actualité.</h2>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {posts.slice(0, 3).map((p) => (
              <article className="workspace-card" key={p.id}>
                {p.cover_image_url ? (
                  <img
                    src={p.cover_image_url}
                    alt=""
                    loading="lazy"
                    width={600}
                    height={400}
                    className="aspect-video w-full rounded-lg object-cover"
                  />
                ) : null}
                <h3 className="mt-4 text-xl font-semibold">{p.title}</h3>
                <p className="line-clamp-3">{p.content}</p>
                <Link
                  className="text-link mt-4"
                  href={
                    preview ? "/commencer" : prefix + "/actualites/" + p.slug
                  }
                >
                  Lire la suite <ArrowUpRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null,
    sponsors:
      moduleEnabled(club.enabled_modules, "sponsors") &&
      data.sponsors.length ? (
        <section className="page-container pb-16">
          <h2 className="mb-6 text-2xl font-semibold">
            Ils font partie de l’aventure.
          </h2>
          <div className="flex flex-wrap gap-6">
            {data.sponsors.map((s) => (
              <img
                key={s.id}
                src={s.logo_url}
                alt={s.company_name}
                width={150}
                height={90}
                className="h-20 w-36 object-contain"
              />
            ))}
          </div>
        </section>
      ) : null,
  };
  return (
    <LivingSite>
      {visibleSections.map((id) => {
        if (!blocks[id]) return null;
        const photo =
          id !== "hero" && id !== "numbers" && id !== "sponsors"
            ? siteImages?.[id]
            : undefined;
        return (
          <div key={id} id={"vitrine-" + id} data-site-section={id}>
            {photo && (
              <div className="page-container">
                <figure className="site-section-photo">
                  <img
                    src={photo.url}
                    alt={photo.title}
                    width={1000}
                    height={430}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  <PhotoCredit image={photo} />
                </figure>
              </div>
            )}
            {blocks[id]}
          </div>
        );
      })}
    </LivingSite>
  );
}
