import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DAY_LABELS, getSportPreset } from "@/config/sports-presets";
import { moduleEnabled, resolveTemplate, SITE_TEMPLATES } from "@/lib/platform";
import type { SiteSectionId } from "@/lib/site-composition";
import type { PublicClubData } from "@/lib/tenant";

export function ClubHero({
  data,
  prefix,
  preview,
  sections,
}: {
  data: PublicClubData;
  prefix: string;
  preview: boolean;
  sections: SiteSectionId[];
}) {
  const { club, siteImages, schedules, categories, events, posts, facilities } =
    data;
  const theme = resolveTemplate(club.theme_preset);
  const sport = getSportPreset(club.sport_type);
  const title = preview
    ? (SITE_TEMPLATES.find((template) => template.id === theme)?.headline ?? [
        club.name,
      ])
    : [club.name];
  const image = siteImages?.hero;
  const heroUrl = image?.url ?? club.hero_image_url;
  const register = moduleEnabled(club.enabled_modules, "inscriptions");
  const trial = moduleEnabled(club.enabled_modules, "trials");
  const nextEvent =
    sections.includes("events") && moduleEnabled(club.enabled_modules, "events")
      ? events.find(
          (event) => preview || Date.parse(event.event_date) >= Date.now(),
        )
      : undefined;
  const quickLinks = [
    sections.includes("practice") && ["practice", "Les créneaux"],
    sections.includes("events") &&
      moduleEnabled(club.enabled_modules, "events") &&
      events.length > 0 && ["events", "L’agenda"],
    sections.includes("news") &&
      moduleEnabled(club.enabled_modules, "news") &&
      posts.length > 0 && ["news", "Le journal du club"],
  ].filter((item): item is string[] => Array.isArray(item));
  const demoHref = "/commencer?modele=" + theme;
  const media = heroUrl ? (
    <figure className="direction-media">
      <img
        src={heroUrl}
        alt={image?.title ?? ""}
        width={1000}
        height={700}
        fetchPriority="high"
        referrerPolicy="no-referrer"
      />
      {image?.source && (
        <a
          href={image.source}
          target="_blank"
          rel="noreferrer"
          className="site-photo-credit"
        >
          Photo d’illustration · {image.credit}
        </a>
      )}
    </figure>
  ) : null;

  return (
    <>
      <section className="direction-hero">
        <div className="page-container direction-grid">
          <div className="direction-copy">
            <span className="direction-kicker">
              {sport.label} · {club.city}
            </span>
            <h1>
              {title[0]}
              {title[1] && (
                <>
                  <br />
                  <em>{title[1]}</em>
                </>
              )}
            </h1>
            <p>{sport.vocabulary.tagline}</p>
            <div className="direction-actions">
              {register && (
                <Link href={preview ? demoHref : prefix + "/inscription"}>
                  Rejoindre le club <ArrowUpRight size={16} />
                </Link>
              )}
              {trial && (
                <Link
                  href={preview ? demoHref : prefix + "/essai"}
                  className="direction-secondary"
                >
                  Faire un essai <ArrowUpRight size={16} />
                </Link>
              )}
            </div>
          </div>
          {theme === "club" &&
            sections.includes("practice") &&
            schedules.length > 0 && (
              <div className="direction-schedule">
                <span className="direction-kicker">Les entraînements</span>
                <h2>Cette semaine</h2>
                {schedules.slice(0, 3).map((slot) => (
                  <details key={slot.id}>
                    <summary>
                      {DAY_LABELS[slot.day_of_week]} ·{" "}
                      {slot.start_time.slice(0, 5)}
                    </summary>
                    <p>
                      {
                        categories.find(
                          (category) => category.id === slot.category_id,
                        )?.name
                      }
                      {" · "}
                      {
                        facilities.find(
                          (facility) => facility.id === slot.facility_id,
                        )?.name
                      }
                    </p>
                  </details>
                ))}
                <a href="#vitrine-practice">
                  Voir tous les créneaux <ArrowUpRight size={16} />
                </a>
              </div>
            )}
          {theme === "studio" && quickLinks.length > 0 && (
            <nav className="direction-index" aria-label="Accès rapides">
              {quickLinks.map(([id, label], index) => (
                <a key={id} href={"#vitrine-" + id}>
                  <small>0{index + 1}</small>
                  <strong>{label}</strong>
                  <ArrowUpRight size={18} />
                </a>
              ))}
            </nav>
          )}
          {theme === "heritage" && (
            <div className="direction-crest">
              {club.logo_url ? (
                <img
                  src={club.logo_url}
                  alt={"Blason de " + club.name}
                  width={360}
                  height={360}
                />
              ) : (
                <div className="direction-shield" aria-hidden="true">
                  <span>{club.name.charAt(0)}</span>
                </div>
              )}
            </div>
          )}
          {media}
        </div>
      </section>
      {theme === "arena" && nextEvent && (
        <a href="#vitrine-events" className="direction-fixture">
          <span className="direction-kicker">Prochain rendez-vous</span>
          <strong>{nextEvent.title}</strong>
          <time dateTime={nextEvent.event_date}>
            {new Date(nextEvent.event_date).toLocaleDateString("fr-FR", {
              day: "numeric",
              month: "long",
              timeZone: "Europe/Paris",
            })}
          </time>
          <ArrowUpRight size={20} />
        </a>
      )}
    </>
  );
}
