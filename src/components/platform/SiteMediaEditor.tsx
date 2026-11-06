"use client";

import { useState } from "react";
import Link from "next/link";
import { saveSiteImage } from "@/actions/site-media.actions";
import { useAction } from "@/components/club-admin/useAction";
import {
  MEDIA_AUDIENCES,
  MEDIA_SECTIONS,
  MEDIA_SPORTS,
  STOCK_PHOTOS,
  type ClubPhoto,
  type MediaChoice,
  type MediaSection,
  type SiteImage,
} from "@/lib/site-media";

type Props = {
  sport: string;
  photos?: ClubPhoto[];
  initial?: Partial<Record<MediaSection, SiteImage>>;
  galleryEnabled?: boolean;
  onPreview?: (section: MediaSection, image?: SiteImage) => void;
};

export function SiteMediaEditor({
  sport,
  photos = [],
  initial = {},
  galleryEnabled,
  onPreview,
}: Props) {
  const [section, setSection] = useState<MediaSection>("hero");
  const [sportFilter, setSportFilter] = useState(
    sport in MEDIA_SPORTS ? sport : "",
  );
  const [audience, setAudience] = useState("");
  const [library, setLibrary] = useState<"stock" | "club">("stock");
  const [published, setPublished] = useState(initial);
  const [selection, setSelection] = useState<{
    choice: MediaChoice;
    image: SiteImage;
  }>();
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [fileError, setFileError] = useState("");
  const { pending, run } = useAction();
  const current = selection?.image ?? published[section];

  const selectImage = (choice: MediaChoice, image: SiteImage) => {
    setFileError("");
    setRightsConfirmed(false);
    if (onPreview) {
      setPublished((previous) => ({ ...previous, [section]: image }));
      onPreview(section, image);
    } else setSelection({ choice, image });
  };
  const save = (choice: MediaChoice | null, image?: SiteImage) => {
    const apply = () => {
      setPublished((previous) => ({ ...previous, [section]: image }));
      setSelection(undefined);
      onPreview?.(section, image);
    };
    if (onPreview) apply();
    else run(() => saveSiteImage(section, choice), apply);
  };
  const stocks = STOCK_PHOTOS.filter(
    (item) =>
      (!sportFilter || item.sport === sportFilter) &&
      (!audience || item.audiences.some((tag) => tag === audience)),
  );

  return (
    <section
      className="workspace-card site-media-editor"
      aria-label="Images de la vitrine"
    >
      <span className="eyebrow">MÉDIATHÈQUE</span>
      <h2>Images de la vitrine</h2>
      <p>Choisissez une image pour chaque section de votre accueil.</p>
      <div className="site-media-fields">
        <label>
          Section
          <select
            disabled={pending}
            value={section}
            onChange={(event) => {
              setSection(event.target.value as MediaSection);
              setSelection(undefined);
              setFileError("");
            }}
          >
            {MEDIA_SECTIONS.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select
            value={library}
            onChange={(event) =>
              setLibrary(event.target.value as "stock" | "club")
            }
          >
            <option value="stock">Bibliothèque Licyo</option>
            <option value="club">Mes photos</option>
          </select>
        </label>
      </div>
      {current && (
        <figure className="site-media-current">
          <img
            src={current.url}
            alt={current.title}
            width={640}
            height={360}
            referrerPolicy="no-referrer"
          />
          <figcaption>
            {current.title}
            {current.source && (
              <>
                {" · "}
                <a href={current.source} target="_blank" rel="noreferrer">
                  Photo de {current.credit}
                </a>
              </>
            )}
          </figcaption>
        </figure>
      )}
      {library === "stock" ? (
        <>
          <div className="site-media-fields">
            <label>
              Sport
              <select
                value={sportFilter}
                onChange={(event) => setSportFilter(event.target.value)}
              >
                <option value="">Tous les sports</option>
                {Object.entries(MEDIA_SPORTS).map(([id, label]) => (
                  <option value={id} key={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Public
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option value="">Tous les publics</option>
                {MEDIA_AUDIENCES.map((tag) => (
                  <option key={tag}>{tag}</option>
                ))}
              </select>
            </label>
          </div>
          {stocks.length ? (
            <div className="site-media-grid">
              {stocks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={pending}
                  aria-pressed={current?.url === item.url}
                  onClick={() =>
                    selectImage({ kind: "stock", id: item.id }, item)
                  }
                >
                  <img
                    src={item.url}
                    alt=""
                    loading="lazy"
                    width={360}
                    height={240}
                    referrerPolicy="no-referrer"
                  />
                  <span>
                    {item.title}
                    <small>{item.audiences.join(" · ")}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p role="status">
              Aucune image dans cette sélection. Essayez un autre public.
            </p>
          )}
        </>
      ) : (
        <>
          {onPreview ? (
            <label className="site-media-file">
              Essayer avec une photo de cet appareil
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  if (
                    !["image/jpeg", "image/png", "image/webp"].includes(
                      file.type,
                    ) ||
                    file.size > 5 * 1024 * 1024
                  ) {
                    setFileError(
                      "Choisissez une photo JPEG, PNG ou WebP de 5 Mo maximum.",
                    );
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === "string")
                      selectImage(
                        { kind: "club", id: "preview" },
                        {
                          url: reader.result,
                          title: "Votre photo",
                        },
                      );
                  };
                  reader.onerror = () =>
                    setFileError("Cette photo n’a pas pu être lue.");
                  reader.readAsDataURL(file);
                }}
              />
              {fileError && <span role="alert">{fileError}</span>}
            </label>
          ) : (
            <>
              {galleryEnabled && (
                <Link className="text-link" href="/club-admin/galerie">
                  Ajouter une photo dans ma galerie
                </Link>
              )}
              {!photos.length && (
                <p>
                  {galleryEnabled
                    ? "Les photos importées apparaîtront ici."
                    : "Activez le module Galerie pour importer vos photos."}
                </p>
              )}
              <div className="site-media-grid">
                {photos.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={pending}
                    aria-pressed={current?.url === item.image_url}
                    onClick={() =>
                      selectImage(
                        { kind: "club", id: item.id },
                        { url: item.image_url, title: item.title },
                      )
                    }
                  >
                    <img
                      src={item.image_url}
                      alt=""
                      loading="lazy"
                      width={360}
                      height={240}
                    />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <div className="site-media-actions">
        {onPreview && current && (
          <p role="status">Image visible dans l’aperçu ci-dessous.</p>
        )}
        {selection && (
          <div className="site-media-publish">
            <label>
              <input
                type="checkbox"
                checked={rightsConfirmed}
                disabled={pending}
                onChange={(event) => setRightsConfirmed(event.target.checked)}
              />
              <span>
                Je confirme avoir vérifié les droits de publication, y compris
                pour les personnes reconnaissables.
              </span>
            </label>
            <button
              type="button"
              className="pill-button"
              disabled={pending || !rightsConfirmed}
              onClick={() => save(selection.choice, selection.image)}
            >
              {pending ? "Publication…" : "Publier cette image"}
            </button>
          </div>
        )}
        {current && (
          <button
            type="button"
            className="text-link"
            disabled={pending}
            onClick={() => save(null)}
          >
            Revenir à l’image par défaut
          </button>
        )}
      </div>
    </section>
  );
}
