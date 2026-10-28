import type { ReactNode } from 'react';

export function PageTitle({ title, intro }: { title: string; intro?: ReactNode }) {
  return (
    <div className="bg-club-primary text-club-primary-fg">
      <div className="page-container py-8 md:py-12">
        <h1 className="text-2xl font-extrabold md:text-4xl">{title}</h1>
        {intro ? <p className="mt-2 max-w-2xl opacity-90">{intro}</p> : null}
      </div>
    </div>
  );
}

/** Texte saisi par le club : paragraphes séparés par des lignes vides, sans HTML. */
export function PlainText({ text }: { text: string }) {
  return (
    <div className="prose-club">
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
    </div>
  );
}
