'use client';
import { useState } from 'react';
import { ClubLanding } from './ClubLanding';
import { SiteComposer } from '@/components/platform/SiteComposer';
import type { PublicClubData } from '@/lib/tenant';
import { DEFAULT_SECTIONS, type SiteSectionId } from '@/lib/site-composition';
export function SitePreview({ data }: { data: PublicClubData }) {
  const [editing, setEditing] = useState(false);
  const [sections, setSections] = useState<SiteSectionId[]>(DEFAULT_SECTIONS);
  return (
    <>
      <div className="page-container preview-composer-toggle">
        <button
          className="pill-button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? 'Fermer l’éditeur' : 'Composer les sections de ce site'}
        </button>
        <span>Essayez : masquer, déplacer, regarder le résultat.</span>
      </div>
      {editing ? (
        <div className="page-container">
          <SiteComposer initial={sections} onChange={setSections} demo />
        </div>
      ) : null}
      <ClubLanding data={data} sections={sections} preview />
    </>
  );
}
