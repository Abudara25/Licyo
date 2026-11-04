'use client';
import { useState } from 'react';
import {
  requestPrivateLesson,
  updateClubRequest,
  addGalleryPhoto,
  removeGalleryPhoto,
} from '@/actions/community.actions';
import { useAction } from '@/components/club-admin/useAction';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea, Select } from '@/components/ui/form';
export function LessonForm({ slug }: { slug: string }) {
  const { pending, run } = useAction();
  const [sent, setSent] = useState(false);
  return sent ? (
    <p className="notice" role="status">
      Votre demande est reçue. Le club vous recontactera.
    </p>
  ) : (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () =>
            requestPrivateLesson({
              slug,
              name: f.get('name'),
              email: f.get('email'),
              message: f.get('message'),
              website: f.get('website'),
            }),
          () => setSent(true),
        );
      }}
    >
      <div className="grid gap-5">
        <Field id="lesson-name" label="Votre nom">
          <Input id="lesson-name" name="name" required maxLength={80} />
        </Field>
        <Field id="lesson-email" label="Votre e-mail">
          <Input
            id="lesson-email"
            name="email"
            type="email"
            required
            maxLength={120}
          />
        </Field>
        <Field id="lesson-message" label="Votre objectif et vos disponibilités">
          <Textarea
            id="lesson-message"
            name="message"
            required
            minLength={10}
            maxLength={2000}
          />
        </Field>
        <input
          name="website"
          type="text"
          tabIndex={-1}
          className="hidden"
          aria-hidden
          defaultValue=""
        />
        <Button type="submit" variant="club" disabled={pending}>
          Envoyer ma demande
        </Button>
      </div>
    </form>
  );
}
export function RequestStatus({ id, status }: { id: string; status: string }) {
  const { run, pending } = useAction();
  return (
    <Select
      aria-label="État de la demande"
      value={status}
      disabled={pending}
      onChange={(e) => run(() => updateClubRequest(id, e.target.value))}
    >
      <option value="new">À traiter</option>
      <option value="contacted">Contact pris</option>
      <option value="closed">Terminée</option>
    </Select>
  );
}
export function GalleryEditor({
  photos,
}: {
  photos: { id: string; title: string; image_url: string }[];
}) {
  const { run, pending } = useAction();
  return (
    <>
      <form
        className="workspace-card grid gap-4 mb-7"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(() => addGalleryPhoto(f));
        }}
      >
        <Field id="gallery-title" label="Légende de la photo">
          <Input id="gallery-title" name="title" required maxLength={120} />
        </Field>
        <Field id="gallery-file" label="Photo">
          <Input
            id="gallery-file"
            name="file"
            required
            type="file"
            accept="image/jpeg,image/png,image/webp"
          />
        </Field>
        <Button type="submit" disabled={pending}>
          Ajouter à la galerie
        </Button>
      </form>
      <div className="grid gap-5 sm:grid-cols-2">
        {photos.map((p) => (
          <article className="workspace-card" key={p.id}>
            <img
              src={p.image_url}
              alt={p.title}
              width={600}
              height={400}
              className="aspect-video w-full rounded-lg object-cover"
            />
            <h2 className="mt-4">{p.title}</h2>
            <Button
              className="mt-3"
              variant="outline"
              disabled={pending}
              onClick={() =>
                confirm('Retirer cette photo de la galerie ?') &&
                run(() => removeGalleryPhoto(p.id))
              }
            >
              Retirer
            </Button>
          </article>
        ))}
      </div>
    </>
  );
}
