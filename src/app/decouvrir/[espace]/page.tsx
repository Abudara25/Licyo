import { ControlPreview } from "@/components/super-admin/ControlPreview";
import { SitePreview } from "@/components/vitrine/SitePreview";
import { SiteComposer } from "@/components/platform/SiteComposer";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Users,
  Home,
  SlidersHorizontal,
  Globe,
  ShieldCheck,
} from "lucide-react";
import { AdminShell, PageHeader } from "@/components/club-admin/AdminShell";
import { ManagementDashboard } from "@/components/platform/ManagementDashboard";
import { ModulesEditor } from "@/components/platform/ModulesEditor";
import { MemberWorkspace } from "@/components/platform/MemberWorkspace";
import { ClubHeader } from "@/components/vitrine/ClubHeader";
import { ClubFooter } from "@/components/vitrine/ClubFooter";
import { defaultModules, resolveTemplate } from "@/lib/platform";
import { clubCssVariables } from "@/lib/utils/color-contrast";
import type { PublicClubData } from "@/lib/tenant";
import { MEDIA_SPORTS } from "@/lib/site-media";
import { SPORTS_PRESETS, birthYearsForSeason } from "@/config/sports-presets";
export default async function Discover({
  params,
  searchParams,
}: {
  params: Promise<{ espace: string }>;
  searchParams: Promise<{ modele?: string; sport?: string; vue?: string }>;
}) {
  const { espace } = await params;
  const { modele, sport, vue } = await searchParams;
  if (!["club", "adherent", "pilotage", "modules", "site"].includes(espace))
    notFound();
  if (espace === "pilotage") return <ControlPreview view={vue} />;
  const template = resolveTemplate(modele ?? "club");
  const preset = SPORTS_PRESETS[sport ?? "football"] ?? SPORTS_PRESETS.football;
  const banner = (
    <div className="preview-banner">
      <span>
        Aperçu public · données fictives · aucune modification enregistrée
      </span>
      <Link href="/commencer">Créer mon propre club ↗</Link>
    </div>
  );
  const nav = [
    {
      href: "/decouvrir/club",
      label: "Espace club",
      glyph: <Home aria-hidden />,
    },
    {
      href: "/decouvrir/adherent",
      label: "Espace adhérent",
      glyph: <Users aria-hidden />,
    },
    {
      href: "/decouvrir/modules",
      label: "Modules et modèle",
      glyph: <SlidersHorizontal aria-hidden />,
    },
    {
      href: "/decouvrir/pilotage",
      label: "Pilotage Licyo",
      glyph: <ShieldCheck aria-hidden />,
    },
    {
      href: "/decouvrir/site",
      label: "Site public",
      glyph: <Globe aria-hidden />,
    },
  ];
  if (espace === "site") {
    const club = {
      id: "preview",
      name:
        preset.id === "football"
          ? "Le collectif commence ici."
          : "Trouvez votre mouvement.",
      slug: "exemple",
      custom_domain: null,
      sport_type: preset.id,
      theme_preset: template,
      primary_color: "#205442",
      secondary_color: "#d6edb1",
      logo_url: null,
      hero_image_url: null,
      club_history_text:
        "Un lieu pour se retrouver, découvrir et progresser. Notre association accueille les débutants comme les passionnés, avec la même attention et le plaisir de pratiquer ensemble.",
      president_word_text:
        "Notre plus belle réussite, c’est de vous voir prendre votre place. Bienvenue dans un club qui avance avec vous.",
      president_name: "L’équipe du club",
      president_signature_url: null,
      rna_number: null,
      siret_number: null,
      federation_name: preset.federation,
      affiliation_number: null,
      city: "Votre ville",
      postal_code: "95000",
      nearby_cities: [],
      contact_email: "contact@example.com",
      contact_phone: null,
      social_links: {},
      sibling_discount_rules: {
        enabled: false,
        second_member_discount: 0,
        third_member_discount: 0,
        discount_type: "fixed_euros",
      },
      accepts_pass_sport: false,
      pass_sport_amount: 0,
      accepts_caf_aids: false,
      accepts_installments: true,
      pass_stripe_fees_to_parents: false,
      enabled_modules: defaultModules(preset.id),
      email_provider: "platform",
      email_sender_address: null,
      status: "demo",
      demo_expires_at: null,
      subscription_plan: "integral",
      stripe_customer_id: null,
      stripe_subscription_id: null,
      stripe_connect_account_id: null,
      stripe_connect_onboarded: false,
      current_season: "2026-2027",
      created_at: "2026-09-01",
      declared_member_count: 0,
      membership_tier_id: null,
    } as PublicClubData["club"];
    const categories = preset.demo.categories.map((c, i) => ({
      id: "cat-" + i,
      club_id: club.id,
      name: c.name,
      ...birthYearsForSeason("2026-2027", c),
      gender_filter: "mixed" as const,
      annual_price: c.price,
      max_capacity: 30,
      medical_requirement: c.medical,
      coach_name: null,
      description: c.description,
      display_order: i,
    }));
    const facility = {
      id: "lieu",
      club_id: club.id,
      name: preset.demo.facilityName,
      address: "Adresse du club",
      city: club.city,
      postal_code: club.postal_code,
      latitude: null,
      longitude: null,
      google_maps_url: null,
    };
    const data: PublicClubData = {
      club,
      categories,
      facilities: [facility],
      schedules: preset.demo.schedules.map(([ci, day, start, end], i) => ({
        id: "s" + i,
        club_id: club.id,
        category_id: "cat-" + ci,
        facility_id: "lieu",
        day_of_week: day,
        start_time: start,
        end_time: end,
      })),
      events: ["Séance découverte ouverte à tous", "La journée du club"].map(
        (title, i) => ({
          id: "event-" + i,
          club_id: club.id,
          category_id: null,
          event_type: "club_event" as const,
          title,
          event_date: "2026-11-" + (14 + i * 7) + "T10:00:00Z",
          location_text: facility.name,
          is_home: true,
          score_club: null,
          score_opponent: null,
          created_at: "2026-11-01",
        }),
      ),
      posts: [
        [
          "On se retrouve pour une nouvelle saison.",
          "Des rencontres, des progrès et de nouveaux défis : découvrez la vie de notre association.",
        ],
        [
          "La découverte commence avec vous.",
          "Débutant ou confirmé, chacun trouve sa place dans nos groupes. Venez rencontrer notre équipe.",
        ],
        [
          "Celles et ceux qui font vivre le club.",
          "Nos bénévoles sont au cœur de chaque séance et de chaque événement. Merci pour leur engagement.",
        ],
      ].map(([title, content], i) => ({
        id: "post-" + i,
        club_id: club.id,
        title,
        slug: "actualite-" + i,
        content,
        cover_image_url: null,
        is_published: true,
        published_at: "2026-11-01T10:00:00Z",
      })),
      sponsors: [],
      products: [],
    };
    return (
      <div
        data-template={template}
        style={clubCssVariables(club.primary_color, club.secondary_color)}
      >
        {banner}
        <div className="page-container flex flex-wrap gap-4 py-3 text-xs">
          <Link className="text-link" href="/modeles">
            ← Les modèles
          </Link>
          {["club", "arena", "studio"].map((t) => (
            <Link
              className="text-link"
              key={t}
              href={"/decouvrir/site?modele=" + t + "&sport=" + preset.id}
            >
              {t}
            </Link>
          ))}
          <form action="/decouvrir/site" className="site-media-sport-nav">
            <input type="hidden" name="modele" value={template} />
            <label>
              Sport de la démo
              <select name="sport" defaultValue={preset.id}>
                {Object.entries(MEDIA_SPORTS).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="text-link">
              Afficher
            </button>
          </form>
        </div>
        <ClubHeader
          name="Votre club"
          logoUrl={null}
          prefix="/decouvrir/site"
          links={[{ href: "/commencer", label: "Créer mon club" }]}
          showRegister={false}
          isDemo={false}
        />
        <SitePreview key={preset.id} data={data} />
        <ClubFooter club={club} facilities={data.facilities} links={[]} />
      </div>
    );
  }
  const rows = [
    {
      id: "1",
      name: "Alex Laurent",
      group: "Groupe adultes",
      status: "Validé",
    },
    {
      id: "2",
      name: "Sam Dubois",
      group: "Groupe découverte",
      status: "À compléter",
    },
    {
      id: "3",
      name: "Morgan Leroy",
      group: "Groupe jeunes",
      status: "À vérifier",
    },
  ];
  return (
    <AdminShell
      title={espace === "adherent" ? "Mon espace famille" : "Mon association"}
      subtitle="Démonstration de la plateforme"
      links={nav}
      banner={banner}
    >
      <PageHeader
        title={
          espace === "adherent"
            ? "Le club, à portée de main."
            : espace === "modules"
              ? "Un espace à votre image."
              : "Une belle saison commence."
        }
        description="Explorez les espaces de Licyo avant de créer votre association."
      />
      {espace === "modules" ? (
        <>
          <SiteComposer demo />
          <ModulesEditor
            settings={defaultModules("football")}
            template="club"
            demo
          />
        </>
      ) : espace === "adherent" ? (
        <MemberWorkspace
          demo
          dossiers={[
            {
              id: "1",
              name: "Alex Laurent",
              club: "Mon association",
              season: "2026-2027",
              category: "Groupe découverte",
              status: "validated",
              reason: null,
              canEdit: false,
              docs: { photo: true, medical: true, id: false },
            },
          ]}
          payments={[
            {
              id: "1",
              club: "Mon association",
              total: 180,
              paid: 120,
              status: "partial",
              invoice: "Cotisation annuelle",
            },
          ]}
          convocations={[]}
        />
      ) : (
        <ManagementDashboard
          count={248}
          pending={12}
          total={38200}
          paid={32400}
          rows={rows}
          events={[
            {
              id: "e",
              title: "La séance du collectif",
              date: "2026-11-12T18:30:00Z",
            },
          ]}
          preview
        />
      )}
    </AdminShell>
  );
}
