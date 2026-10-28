'use client';

import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { deletePost, deleteProduct, deleteSponsor, updateClubTexts, updateSponsorLead, upsertPost, upsertProduct, upsertSponsor } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import { formatEuros } from '@/lib/pricing';
import type { Club, ClubProduct, Post, Sponsor, SponsorLead } from '@/types/database';
import { ImageUpload } from './ImageUpload';
import { useAction } from './useAction';

type Editing = { kind: 'post' | 'sponsor' | 'product'; data: Record<string, string | boolean | number> } | null;

export function ContentManager({ club, posts, sponsors, leads, products }: { club: Club; posts: Post[]; sponsors: Sponsor[]; leads: SponsorLead[]; products: ClubProduct[] }) {
  const [tab, setTab] = useState<'club' | 'posts' | 'sponsors' | 'shop'>('club');
  const [texts, setTexts] = useState({ club_history_text: club.club_history_text ?? '', president_word_text: club.president_word_text ?? '', president_name: club.president_name ?? '' });
  const [editing, setEditing] = useState<Editing>(null);
  const { pending, run } = useAction();
  const set = (k: string, v: string | boolean | number) => setEditing((e) => (e ? { ...e, data: { ...e.data, [k]: v } } : e));
  const d = (editing?.data ?? {}) as Record<string, string & boolean>;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {([['club', 'Présentation'], ['posts', 'Actualités'], ['sponsors', 'Partenaires'], ['shop', 'Boutique']] as const).map(([k, l]) => (
          <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>{l}</Button>
        ))}
      </div>

      {tab === 'club' ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader title="Textes de la page d'accueil" />
            <CardBody>
              <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); run(() => updateClubTexts(texts)); }}>
                <Field id="hist" label="Présentation du club" hint="Une ligne vide sépare les paragraphes."><Textarea id="hist" rows={8} value={texts.club_history_text} onChange={(e) => setTexts({ ...texts, club_history_text: e.target.value })} /></Field>
                <Field id="word" label="Le mot du président"><Textarea id="word" rows={6} value={texts.president_word_text} onChange={(e) => setTexts({ ...texts, president_word_text: e.target.value })} /></Field>
                <Field id="pres" label="Nom du président (signe les attestations)"><Input id="pres" value={texts.president_name} onChange={(e) => setTexts({ ...texts, president_name: e.target.value })} /></Field>
                <Button type="submit" disabled={pending}>Enregistrer</Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Images" />
            <CardBody className="grid gap-4">
              <ImageUpload kind="logo" label="Logo du club" value={club.logo_url} />
              <ImageUpload kind="hero" label="Photo d'accueil" value={club.hero_image_url} />
              <ImageUpload kind="signature" label="Signature du président (attestations)" value={club.president_signature_url} />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'posts' ? (
        <Card>
          <CardHeader title="Actualités" action={<Button onClick={() => setEditing({ kind: 'post', data: { title: '', content: '', cover_image_url: '', is_published: true } })}><Plus aria-hidden /> Rédiger</Button>} />
          {posts.length === 0 ? <CardBody><EmptyState title="Aucune actualité" description="Résultats, stages, assemblée générale : publiez en quelques secondes." /></CardBody> : null}
          <ul className="divide-y">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.title} {!p.is_published ? <Badge tone="warning">Brouillon</Badge> : null}</p>
                  <p className="text-sm text-muted-foreground">{new Date(p.published_at).toLocaleDateString('fr-FR')}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Modifier ${p.title}`} onClick={() => setEditing({ kind: 'post', data: { id: p.id, title: p.title, content: p.content, cover_image_url: p.cover_image_url ?? '', is_published: p.is_published } })}><Pencil aria-hidden /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Supprimer ${p.title}`} onClick={() => confirm('Supprimer cette actualité ?') && run(() => deletePost(p.id))}><Trash2 aria-hidden /></Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tab === 'sponsors' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Partenaires affichés" action={<Button onClick={() => setEditing({ kind: 'sponsor', data: { company_name: '', logo_url: '', website_url: '', description: '', display_order: sponsors.length } })}><Plus aria-hidden /> Ajouter</Button>} />
            <ul className="divide-y">
              {sponsors.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 p-3">
                  <span className="flex min-w-0 items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.logo_url} alt="" className="size-10 shrink-0 object-contain" />
                    <span className="truncate font-medium">{s.company_name}</span>
                  </span>
                  <span className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Modifier ${s.company_name}`} onClick={() => setEditing({ kind: 'sponsor', data: { id: s.id, company_name: s.company_name, logo_url: s.logo_url, website_url: s.website_url ?? '', description: s.description ?? '', display_order: s.display_order } })}><Pencil aria-hidden /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Supprimer ${s.company_name}`} onClick={() => confirm('Retirer ce partenaire ?') && run(() => deleteSponsor(s.id))}><Trash2 aria-hidden /></Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Demandes reçues" description="Formulaire « Devenir partenaire » du site" />
            {leads.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">Aucune demande pour le moment.</p></CardBody> : null}
            <ul className="divide-y">
              {leads.map((l) => (
                <li key={l.id} className="grid gap-1 p-3">
                  <p className="font-medium">{l.company_name} <span className="text-sm font-normal text-muted-foreground">- {l.contact_name}</span></p>
                  <p className="text-sm"><a className="underline" href={`tel:${l.phone}`}>{l.phone}</a> - <a className="underline" href={`mailto:${l.email}`}>{l.email}</a>{l.estimated_budget ? ` - ${l.estimated_budget}` : ''}</p>
                  <Select aria-label={`Suivi de ${l.company_name}`} className="w-44" value={l.status} onChange={(e) => run(() => updateSponsorLead(l.id, e.target.value as 'new'))}>
                    <option value="new">Nouveau</option><option value="contacted">Contacté</option><option value="won">Partenaire</option><option value="lost">Sans suite</option>
                  </Select>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {tab === 'shop' ? (
        <Card>
          <CardHeader title="Boutique" description="Articles proposés pendant l'inscription" action={<Button onClick={() => setEditing({ kind: 'product', data: { name: '', price: '', available_sizes: 'S, M, L', photo_url: '' } })}><Plus aria-hidden /> Ajouter</Button>} />
          <ul className="divide-y">
            {products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 p-3">
                <p><span className="font-medium">{p.name}</span> - {formatEuros(Number(p.price))} <span className="text-sm text-muted-foreground">({p.available_sizes.join(', ')})</span></p>
                <span className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label={`Modifier ${p.name}`} onClick={() => setEditing({ kind: 'product', data: { id: p.id, name: p.name, price: p.price, available_sizes: p.available_sizes.join(', '), photo_url: p.photo_url ?? '' } })}><Pencil aria-hidden /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Supprimer ${p.name}`} onClick={() => confirm('Supprimer cet article ?') && run(() => deleteProduct(p.id))}><Trash2 aria-hidden /></Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={{ post: 'Actualité', sponsor: 'Partenaire', product: 'Article' }[editing?.kind ?? 'post']}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            const fn = editing.kind === 'post' ? upsertPost : editing.kind === 'sponsor' ? upsertSponsor : upsertProduct;
            run(() => fn(editing.data), () => setEditing(null));
          }}
        >
          {editing?.kind === 'post' ? (
            <>
              <Field id="po-t" label="Titre"><Input id="po-t" required value={d.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field id="po-c" label="Texte" hint="Une ligne vide sépare les paragraphes."><Textarea id="po-c" rows={10} required value={d.content ?? ''} onChange={(e) => set('content', e.target.value)} /></Field>
              <ImageUpload kind="post" label="Photo de couverture" value={d.cover_image_url || null} onUploaded={(u) => set('cover_image_url', u)} />
              <Checkbox id="po-p" checked={Boolean(d.is_published)} onChange={(v) => set('is_published', v)} label="Publier sur le site" />
            </>
          ) : null}
          {editing?.kind === 'sponsor' ? (
            <>
              <Field id="sp-n" label="Entreprise"><Input id="sp-n" required value={d.company_name ?? ''} onChange={(e) => set('company_name', e.target.value)} /></Field>
              <ImageUpload kind="sponsor" label="Logo" value={d.logo_url || null} onUploaded={(u) => set('logo_url', u)} />
              <Field id="sp-w" label="Site web (facultatif)"><Input id="sp-w" type="url" value={d.website_url ?? ''} onChange={(e) => set('website_url', e.target.value)} /></Field>
              <Field id="sp-d" label="Description (facultatif)"><Textarea id="sp-d" value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
            </>
          ) : null}
          {editing?.kind === 'product' ? (
            <>
              <Field id="pr-n" label="Nom"><Input id="pr-n" required value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field id="pr-p" label="Prix (€)"><Input id="pr-p" type="number" step="0.01" min="0" inputMode="decimal" required value={d.price ?? ''} onChange={(e) => set('price', e.target.value)} /></Field>
              <Field id="pr-s" label="Tailles" hint="Séparées par des virgules : 8 ans, 10 ans, S, M, L"><Input id="pr-s" required value={d.available_sizes ?? ''} onChange={(e) => set('available_sizes', e.target.value)} /></Field>
              <ImageUpload kind="product" label="Photo (facultatif)" value={d.photo_url || null} onUploaded={(u) => set('photo_url', u)} />
            </>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>Enregistrer</Button>
        </form>
      </Dialog>
    </>
  );
}
