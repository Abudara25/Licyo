import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  Users,
  Globe2,
  Wallet,
  CalendarDays,
  SlidersHorizontal,
  ShieldCheck,
} from 'lucide-react';
import { ProductPreview } from '@/components/platform/ProductPreview';
import { TemplateCard } from '@/components/platform/TemplateCard';
import { SITE_TEMPLATES } from '@/lib/platform';
const features = [
  {
    Icon: Globe2,
    title: 'Un site qui vous ressemble',
    text: 'Choisissez votre modèle, ajoutez vos couleurs et racontez votre histoire.',
  },
  {
    Icon: Users,
    title: 'Votre gestion, simplifiée',
    text: 'Adhérents, inscriptions, documents et familles : une vue claire pour le bureau.',
  },
  {
    Icon: Wallet,
    title: 'Des cotisations bien suivies',
    text: 'Paiements en ligne, règlements au club et échéanciers, réunis dans votre trésorerie.',
  },
  {
    Icon: CalendarDays,
    title: 'La pratique avant tout',
    text: 'Cours, groupes, présences et événements s’adaptent à votre manière de fonctionner.',
  },
  {
    Icon: SlidersHorizontal,
    title: 'Juste ce dont vous avez besoin',
    text: 'Activez vos modules. Masquez les sections inutiles. Évoluez au fil des saisons.',
  },
  {
    Icon: ShieldCheck,
    title: 'Un espace pour les familles',
    text: 'Chaque famille retrouve ses dossiers, documents et convocations dans son espace.',
  },
];
export default function Home() {
  return (
    <>
      <section className="home-hero">
        <div className="page-container">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="live-dot" /> LE NOUVEAU TERRAIN DE VOTRE CLUB
            </span>
            <h1>
              Votre club.
              <br />
              Toute son <em>énergie.</em>
            </h1>
            <p>
              Un beau site. Une gestion qui respire. Des adhérents bien
              accompagnés. Tout votre club, enfin au même endroit.
            </p>
            <div className="hero-actions">
              <Link className="pill-button" href="/commencer">
                Créer mon espace club <ArrowUpRight size={20} />
              </Link>
              <Link className="text-link" href="/decouvrir/club">
                Explorer la plateforme <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="hero-reassurance">
              <span>
                <Check size={15} /> Tous les sports
              </span>
              <span>
                <Check size={15} /> À la taille de votre association
              </span>
            </div>
          </div>
          <div className="hero-product">
            <span className="floating-note">
              <span className="live-dot" /> Une nouvelle saison, l’esprit libre.
            </span>
            <ProductPreview />
            <span className="preview-label">
              Aperçu de l’interface · données d’exemple
            </span>
          </div>
        </div>
      </section>
      <div className="sports-strip">
        <div className="page-container">
          <span>UNE MÊME PASSION, MILLE FAÇONS DE LA VIVRE</span>
          <p>
            Football <i /> Muay thaï <i /> Tennis <i /> Danse <i /> Natation{' '}
            <i /> Et votre sport.
          </p>
        </div>
      </div>
      <section id="fonctionnalites" className="section-space page-container">
        <div className="section-intro">
          <div>
            <span className="eyebrow">LE CLUB, AU CENTRE</span>
            <h2>
              Moins d’administratif.
              <br />
              Plus de collectif.
            </h2>
          </div>
          <p>
            Du premier clic sur votre site à la prochaine saison, chaque
            personne trouve sa place.
          </p>
        </div>
        <div className="feature-grid">
          {features.map(({ Icon, title, text }, i) => (
            <article key={title} className={'feature feature-' + i}>
              <span className="feature-icon">
                <Icon size={23} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="templates-section">
        <div className="page-container section-space">
          <div className="section-intro">
            <div>
              <span className="eyebrow">QUATRE MODÈLES, VOTRE IDENTITÉ</span>
              <h2>
                Le même club.
                <br />
                Votre propre style.
              </h2>
            </div>
            <Link className="text-link" href="/modeles">
              Explorer les modèles <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="template-grid">
            {SITE_TEMPLATES.map((t, i) => (
              <TemplateCard key={t.id} template={t} index={i} />
            ))}
          </div>
        </div>
      </section>
      <section className="page-container section-space">
        <div className="journey">
          <div>
            <span className="eyebrow">SIMPLE DÈS LE DÉPART</span>
            <h2>
              Votre prochain chapitre
              <br />
              commence ici.
            </h2>
            <p>Une plateforme commune. Des espaces adaptés à chacun.</p>
            <Link className="pill-button" href="/commencer">
              C’est parti <ArrowUpRight size={19} />
            </Link>
          </div>
          <ol>
            {[
              [
                '01',
                'Parlez-nous de votre club',
                'Votre sport et votre effectif définissent votre configuration.',
              ],
              [
                '02',
                'Choisissez votre style',
                'Quatre modèles, vos couleurs et les sections utiles à votre association.',
              ],
              [
                '03',
                'Faites vivre votre club',
                'Votre équipe gère. Vos adhérents suivent. Vous avancez ensemble.',
              ],
            ].map(([n, t, d]) => (
              <li key={n}>
                <span>{n}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="closing-section">
        <div className="page-container">
          <span className="eyebrow">PETIT CLUB OU GRANDE ASSOCIATION</span>
          <h2>
            Une offre à votre taille.
            <br />
            La même ambition pour tous.
          </h2>
          <p>
            L’abonnement suit votre effectif. Les quatre modèles et les modules
            sont communs à tous les sports.
          </p>
          <Link className="pill-button light" href="/tarifs">
            Trouver mon offre <ArrowUpRight size={20} />
          </Link>
        </div>
      </section>
    </>
  );
}
