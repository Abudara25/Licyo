'use client';
import { useState } from 'react';
import {
  MODULES,
  SITE_TEMPLATES,
  moduleEnabled,
  resolveTemplate,
} from '@/lib/platform';
import { saveClubModules } from '@/actions/platform.actions';
import { Button } from '@/components/ui/button';
import { useAction } from '@/components/club-admin/useAction';
export function ModulesEditor({
  settings,
  template,
  demo = false,
}: {
  settings: Record<string, boolean>;
  template: string;
  demo?: boolean;
}) {
  const [v, setV] = useState(() =>
    Object.fromEntries(
      MODULES.map((m) => [m.id, moduleEnabled(settings, m.id)]),
    ),
  );
  const [model, setModel] = useState(resolveTemplate(template));
  const { pending, run } = useAction();
  return (
    <div>
      <div className="workspace-card mb-7">
        <h2>L’apparence de votre site</h2>
        <p>Trois modèles. Les mêmes contenus, le même club.</p>
        <div className="template-options">
          {SITE_TEMPLATES.map((t) => (
            <label className="template-option" key={t.id}>
              <input
                type="radio"
                name="site-template"
                checked={model === t.id}
                onChange={() => setModel(t.id)}
              />
              <span>
                <strong>{t.name}</strong>
                <small>{t.eyebrow}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="module-grid">
        {MODULES.map((m) => (
          <label
            className={'module-card ' + (v[m.id] ? 'enabled' : '')}
            key={m.id}
          >
            <input
              type="checkbox"
              checked={v[m.id]}
              onChange={(e) => setV({ ...v, [m.id]: e.target.checked })}
            />
            <span>
              <small className="eyebrow">{m.category}</small>
              <h3 className="mt-2">{m.name}</h3>
              <p>{m.description}</p>
            </span>
          </label>
        ))}
      </div>
      <div className="editor-actions">
        <Button
          size="lg"
          disabled={pending}
          onClick={() =>
            demo ? undefined : run(() => saveClubModules(v, model))
          }
        >
          {demo
            ? 'Aperçu interactif · non enregistré'
            : pending
              ? 'Enregistrement…'
              : 'Enregistrer mes choix'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Un module désactivé conserve ses données.
        </p>
      </div>
    </div>
  );
}
