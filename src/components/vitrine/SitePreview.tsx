"use client";
import { useState } from "react";
import { ClubLanding } from "./ClubLanding";
import { SiteMediaEditor } from "@/components/platform/SiteMediaEditor";
import {
  STOCK_PHOTOS,
  type MediaSection,
  type SiteImage,
} from "@/lib/site-media";
import { SiteComposer } from "@/components/platform/SiteComposer";
import type { PublicClubData } from "@/lib/tenant";
import { DEFAULT_SECTIONS, type SiteSectionId } from "@/lib/site-composition";
export function SitePreview({ data }: { data: PublicClubData }) {
  const [editing, setEditing] = useState(false);
  const [sections, setSections] = useState<SiteSectionId[]>(DEFAULT_SECTIONS);
  const [images, setImages] = useState<
    Partial<Record<MediaSection, SiteImage>>
  >(() => ({
    hero:
      data.club.theme_preset === "heritage"
        ? undefined
        : STOCK_PHOTOS.find((photo) => photo.sport === data.club.sport_type),
  }));
  return (
    <>
      <div className="page-container preview-composer-toggle">
        <button
          className="pill-button"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Fermer l’éditeur" : "Composer les sections de ce site"}
        </button>
        <span>Essayez : masquer, déplacer, regarder le résultat.</span>
      </div>
      {editing ? (
        <div className="page-container">
          <SiteMediaEditor
            sport={data.club.sport_type}
            initial={images}
            onPreview={(section, image) =>
              setImages((previous) => ({ ...previous, [section]: image }))
            }
          />
          <SiteComposer initial={sections} onChange={setSections} demo />
        </div>
      ) : null}
      <ClubLanding
        data={{ ...data, siteImages: images }}
        sections={sections}
        preview
      />
    </>
  );
}
