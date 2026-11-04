'use client';
import { useState } from 'react';
import { ArrowUp, ArrowDown, Eye } from 'lucide-react';
import {
  SITE_SECTIONS,
  resolveSections,
  type SiteSectionId,
} from '@/lib/site-composition';
import { saveSiteComposition } from '@/actions/platform.actions';
import { useAction } from '@/components/club-admin/useAction';
export function SiteComposer({
  initial,
  onChange,
  demo = false,
}: {
  initial?: string[];
  onChange?: (ids: SiteSectionId[]) => void;
  demo?: boolean;
}) {
  const [order, setOrder] = useState(() => [
    ...resolveSections(initial),
    ...SITE_SECTIONS.map((s) => s.id).filter(
      (id) => !resolveSections(initial).includes(id),
    ),
  ]);
  const [enabled, setEnabled] = useState(() => resolveSections(initial));
  const { pending, run } = useAction();
  const [message, setMessage] = useState('');
  const update = (nextOrder: SiteSectionId[], nextEnabled: SiteSectionId[]) => {
    setOrder(nextOrder);
    setEnabled(nextEnabled);
    onChange?.(nextOrder.filter((id) => nextEnabled.includes(id)));
    setMessage(
      'Composition modifiée' +
        (demo ? ' dans cet aperçu.' : ' · enregistrez pour publier.'),
    );
  };
  const move = (i: number, d: number) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    update(next, enabled);
  };
  return (
    <section className="site-composer workspace-card">
      <div className="section-intro">
        <div>
          <span className="eyebrow">VOTRE PAGE D’ACCUEIL</span>
          <h2>Composez votre vitrine.</h2>
        </div>
        <p>
          Activez vos sections et changez leur ordre. Les blocs sans contenu
          restent masqués.
        </p>
      </div>
      <ol>
        {order.map((id, i) => (
          <li key={id}>
            <label>
              <input
                type="checkbox"
                checked={enabled.includes(id)}
                disabled={id === 'hero'}
                onChange={(e) =>
                  update(
                    order,
                    e.target.checked
                      ? [...enabled, id]
                      : enabled.filter((x) => x !== id),
                  )
                }
              />
              <span>
                {SITE_SECTIONS.find((s) => s.id === id)?.label}
                {id === 'hero' ? <small>Section obligatoire</small> : null}
              </span>
            </label>
            <div>
              <button
                type="button"
                disabled={i === 0}
                aria-label={
                  'Monter ' + SITE_SECTIONS.find((s) => s.id === id)?.label
                }
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={17} />
              </button>
              <button
                type="button"
                disabled={i === order.length - 1}
                aria-label={
                  'Descendre ' + SITE_SECTIONS.find((s) => s.id === id)?.label
                }
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={17} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className="composer-feedback" role="status">
        {message ||
          'Les animations respectent les préférences de réduction des mouvements.'}
      </p>
      {demo ? (
        <p className="notice">
          <Eye size={16} /> Aperçu immédiat ci-dessous · aucune publication
        </p>
      ) : (
        <button
          className="pill-button"
          disabled={pending}
          onClick={() =>
            run(() =>
              saveSiteComposition(order.filter((id) => enabled.includes(id))),
            )
          }
        >
          {pending ? 'Enregistrement…' : 'Publier la composition'}
        </button>
      )}
    </section>
  );
}
