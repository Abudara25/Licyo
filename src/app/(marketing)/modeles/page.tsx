import { SITE_TEMPLATES } from '@/lib/platform';
import { TemplateCard } from '@/components/platform/TemplateCard';
export default function ModelsPage() {
  return (
    <div className="page-container section-space">
      <div className="page-heading">
        <span className="eyebrow">VOTRE STYLE, SANS COMPROMIS</span>
        <h1>
          Quatre regards.
          <br />
          Une seule passion.
        </h1>
        <p>
          Collectif, individuel, combat ou expression : chaque modèle convient à
          votre sport. Vous pourrez en changer à tout moment.
        </p>
      </div>
      <div className="template-grid">
        {SITE_TEMPLATES.map((t, i) => (
          <TemplateCard key={t.id} template={t} index={i} />
        ))}
      </div>
    </div>
  );
}
