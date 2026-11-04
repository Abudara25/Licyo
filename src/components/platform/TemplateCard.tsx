import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { SITE_TEMPLATES } from '@/lib/platform';
export function TemplateCard({
  template,
  index,
}: {
  template: (typeof SITE_TEMPLATES)[number];
  index: number;
}) {
  return (
    <article className="template-card">
      <Link
        href={'/decouvrir/site?modele=' + template.id}
        className={'template-snapshot template-' + template.id}
        aria-label={'Découvrir le modèle ' + template.name}
      >
        <div className="template-mini-nav">
          <b>votre club.</b>
          <span>Le club · Nos cours</span>
          <i />
        </div>
        <div className="template-mini-hero">
          <small>{template.eyebrow}</small>
          <strong>
            {template.id === 'club' ? (
              <>
                Une passion.
                <br />
                Un collectif.
              </>
            ) : template.id === 'arena' ? (
              <>
                FAITES
                <br />
                VIBRER
                <br />
                VOTRE CLUB.
              </>
            ) : (
              <>
                Le plaisir
                <br />
                du mouvement.
              </>
            )}
          </strong>
          <span className="template-mini-button">
            Rejoindre le club <ArrowUpRight size={12} />
          </span>
          <div className="template-art">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="template-mini-footer">
          <span>Découvrir</span>
          <span>Partager</span>
          <span>Progresser</span>
        </div>
      </Link>
      <div className="template-caption">
        <div>
          <small>
            0{index + 1} / {template.eyebrow}
          </small>
          <h3>{template.name}</h3>
        </div>
        <Link
          className="round-link"
          href={'/decouvrir/site?modele=' + template.id}
          aria-label={'Voir ' + template.name}
        >
          <ArrowUpRight size={20} />
        </Link>
      </div>
      <p>{template.description}</p>
    </article>
  );
}
