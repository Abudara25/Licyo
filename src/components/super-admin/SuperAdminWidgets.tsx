'use client';

import { useState } from 'react';
import Link from 'next/link';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { ExternalLink, FileDown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createAnnouncement,
  createDemoClub,
  deleteClub,
  deleteProspect,
  importMembers,
  inviteClubOwner,
  moveProspect,
  startImpersonation,
  toggleAnnouncement,
  updateClubAdmin,
  upsertProspect,
} from '@/actions/super-admin.actions';
import { SPORTS_PRESETS } from '@/config/sports-presets';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import { useAction } from '@/components/club-admin/useAction';
import type { PlatformAnnouncement, SaasProspect } from '@/types/database';

// ---------------------------------------------------------------------------
// Générateur de démo
// ---------------------------------------------------------------------------

export function DemoGeneratorForm({ prospects, rootDomain }: { prospects: { id: string; label: string; city: string; sport: string; email: string | null; name: string }[]; rootDomain: string }) {
  const [v, setV] = useState({ name: '', sportType: 'football', city: '', postalCode: '', contactEmail: '', primaryColor: '', secondaryColor: '', prospectId: '' });
  const [created, setCreated] = useState<{ clubId: string; slug: string } | null>(null);
  const { pending, run } = useAction();
  const preset = SPORTS_PRESETS[v.sportType];
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Nouveau club de démonstration" description="Club, lieu, 4 groupes, 6 créneaux, 2 événements, 3 actualités et une boutique, en un clic." />
        <CardBody>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const res = await createDemoClub(v);
                if (res.ok && res.data) setCreated(res.data);
                return res;
              });
            }}
          >
            {prospects.length ? (
              <Field id="dg-p" label="Depuis un prospect (facultatif)" className="sm:col-span-2">
                <Select
                  id="dg-p"
                  value={v.prospectId}
                  onChange={(e) => {
                    const p = prospects.find((x) => x.id === e.target.value);
                    setV(p ? { ...v, prospectId: p.id, name: p.name, city: p.city, sportType: SPORTS_PRESETS[p.sport] ? p.sport : v.sportType, contactEmail: p.email ?? v.contactEmail } : { ...v, prospectId: '' });
                  }}
                >
                  <option value="">Aucun</option>
                  {prospects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field id="dg-n" label="Nom du club"><Input id="dg-n" required value={v.name} onChange={set('name')} /></Field>
            <Field id="dg-s" label="Sport">
              <Select id="dg-s" value={v.sportType} onChange={set('sportType')}>
                {Object.values(SPORTS_PRESETS).map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.label}</option>)}
              </Select>
            </Field>
            <Field id="dg-c" label="Ville"><Input id="dg-c" required value={v.city} onChange={set('city')} /></Field>
            <Field id="dg-pc" label="Code postal"><Input id="dg-pc" required inputMode="numeric" maxLength={5} value={v.postalCode} onChange={set('postalCode')} /></Field>
            <Field id="dg-e" label="E-mail de contact" className="sm:col-span-2"><Input id="dg-e" type="email" required value={v.contactEmail} onChange={set('contactEmail')} /></Field>
            <Field id="dg-c1" label="Couleur principale (facultatif)" hint={`Par défaut ${preset?.defaultPrimary}`}><Input id="dg-c1" type="color" className="h-11 p-1" value={v.primaryColor || preset?.defaultPrimary} onChange={set('primaryColor')} /></Field>
            <Field id="dg-c2" label="Couleur secondaire (facultatif)" hint={`Par défaut ${preset?.defaultSecondary}`}><Input id="dg-c2" type="color" className="h-11 p-1" value={v.secondaryColor || preset?.defaultSecondary} onChange={set('secondaryColor')} /></Field>
            <Button type="submit" size="lg" className="sm:col-span-2" disabled={pending}>{pending ? 'Création…' : 'Générer la démo'}</Button>
          </form>
        </CardBody>
      </Card>
      <Card className="h-fit">
        <CardHeader title="Résultat" />
        <CardBody>
          {created ? (
            <div className="grid gap-2">
              <a className="inline-flex min-h-11 items-center gap-2 font-semibold underline" href={`${location.protocol}//${created.slug}.${rootDomain}`} target="_blank" rel="noopener noreferrer">
                {created.slug}.{rootDomain} <ExternalLink className="size-4" aria-hidden />
              </a>
              <form action={startImpersonation.bind(null, created.clubId)}>
                <Button type="submit" variant="outline" className="w-full">Ouvrir son back-office</Button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Le lien du site apparaîtra ici.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clubs et Mode Miroir
// ---------------------------------------------------------------------------

export type ClubRow = { id: string; name: string; slug: string; city: string; sport: string; status: string; plan: string; demoExpiresAt: string | null; members: number; siteUrl: string };

export function ClubsTable({ clubs }: { clubs: ClubRow[] }) {
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState<ClubRow | null>(null);
  const [owner, setOwner] = useState({ email: '', fullName: '', role: 'president' });
  const { pending, run } = useAction();
  const q = query.trim().toLowerCase();
  const rows = clubs.filter((c) => !q || `${c.name} ${c.slug} ${c.city}`.toLowerCase().includes(q));
  const tone = (s: string) => (s === 'active' ? 'success' : s === 'demo' ? 'info' : s === 'suspended' ? 'warning' : 'neutral') as 'success';

  return (
    <Card>
      <CardHeader title={`${clubs.length} club(s)`} action={<Input aria-label="Rechercher un club" placeholder="Rechercher" value={query} onChange={(e) => setQuery(e.target.value)} className="w-56" />} />
      {rows.length === 0 ? <CardBody><EmptyState title="Aucun club" /></CardBody> : null}
      <ul className="divide-y">
        {rows.map((c) => (
          <li key={c.id} className="grid gap-2 p-3 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="font-semibold">{c.name} <Badge tone={tone(c.status)}>{c.status}</Badge> <Badge>{c.plan}</Badge></p>
              <p className="text-sm text-muted-foreground">
                {c.sport} - {c.city} - {c.members} adhérent(s)
                {c.status === 'demo' && c.demoExpiresAt ? ` - démo jusqu'au ${new Date(c.demoExpiresAt).toLocaleDateString('fr-FR')}` : ''}
              </p>
              <a href={c.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm underline">{c.siteUrl.replace(/^https?:\/\//, '')}</a>
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={startImpersonation.bind(null, c.id)}>
                <Button type="submit" size="sm">Prendre le contrôle</Button>
              </form>
              <Button size="sm" variant="outline" onClick={() => setInviting(c)}>Donner l'accès</Button>
              <Select aria-label={`Statut de ${c.name}`} className="min-h-11 w-40" value={c.status} onChange={(e) => run(() => updateClubAdmin(c.id, { status: e.target.value }))}>
                <option value="demo">Démo</option><option value="active">Actif</option><option value="suspended">Suspendu</option><option value="archived">Archivé</option>
              </Select>
              {c.status === 'demo' ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updateClubAdmin(c.id, { extendDemoDays: 14 }))}>+14 jours</Button> : null}
              {c.status !== 'active' ? (
                <Button size="icon" variant="ghost" aria-label={`Supprimer ${c.name}`} onClick={() => { const s = prompt(`Tapez « ${c.slug} » pour supprimer définitivement ce club :`); if (s) run(() => deleteClub(c.id, s)); }}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={inviting !== null} onOpenChange={(o) => !o && setInviting(null)} title="Donner l'accès au back-office" description={inviting?.name}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (inviting) run(() => inviteClubOwner(inviting.id, owner), () => setInviting(null)); }}>
          <Field id="ow-n" label="Nom et prénom"><Input id="ow-n" required value={owner.fullName} onChange={(e) => setOwner({ ...owner, fullName: e.target.value })} /></Field>
          <Field id="ow-e" label="E-mail"><Input id="ow-e" type="email" required value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} /></Field>
          <Field id="ow-r" label="Rôle">
            <Select id="ow-r" value={owner.role} onChange={(e) => setOwner({ ...owner, role: e.target.value })}>
              <option value="president">Président(e)</option><option value="secretary">Secrétaire</option><option value="treasurer">Trésorier(e)</option><option value="coach">Éducateur</option>
            </Select>
          </Field>
          <Button type="submit" size="lg" disabled={pending}>Envoyer l'invitation</Button>
        </form>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// CRM prospects
// ---------------------------------------------------------------------------

const STAGES = [
  ['lead', 'À contacter'],
  ['contacted', 'Contacté'],
  ['demo', 'Démo'],
  ['quote_sent', 'Devis envoyé'],
  ['won', 'Gagné'],
  ['lost', 'Perdu'],
] as const;

export function ProspectBoard({ prospects }: { prospects: SaasProspect[] }) {
  const [editing, setEditing] = useState<Partial<SaasProspect> | null>(null);
  const { pending, run } = useAction();
  const e = editing ?? {};
  const set = (k: keyof SaasProspect) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setEditing({ ...e, [k]: ev.target.value });

  return (
    <>
      <div className="mb-4"><Button onClick={() => setEditing({ stage: 'lead', sport_type: 'football' })}><Plus aria-hidden /> Nouveau prospect</Button></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STAGES.map(([stage, label]) => {
          const items = prospects.filter((p) => p.stage === stage);
          return (
            <Card key={stage}>
              <CardHeader title={label} description={`${items.length} prospect(s)`} />
              <ul className="divide-y">
                {items.map((p) => (
                  <li key={p.id} className="grid gap-2 p-3">
                    <div>
                      <p className="font-medium">{p.club_name}</p>
                      <p className="text-sm text-muted-foreground">{SPORTS_PRESETS[p.sport_type]?.label ?? p.sport_type} - {p.city}{p.contact_name ? ` - ${p.contact_name}` : ''}</p>
                      {p.phone ? <a href={`tel:${p.phone}`} className="inline-flex min-h-11 items-center text-sm underline">{p.phone}</a> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Select aria-label={`Étape de ${p.club_name}`} className="min-h-11 w-40" value={p.stage} onChange={(ev) => run(() => moveProspect(p.id, ev.target.value))}>
                        {STAGES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}
                      </Select>
                      <a href={`/api/pdf/quote?prospect=${p.id}`} target="_blank" className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-2 text-xs font-semibold hover:bg-accent"><FileDown className="size-4" aria-hidden /> Devis</a>
                      {!p.demo_club_id ? <Link href={`/super-admin/demo-generator?prospect=${p.id}`} className="inline-flex min-h-9 items-center rounded-lg border px-2 text-xs font-semibold hover:bg-accent">Démo</Link> : null}
                      <Button size="icon" variant="ghost" aria-label={`Modifier ${p.club_name}`} onClick={() => setEditing(p)}><Pencil aria-hidden /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Supprimer ${p.club_name}`} onClick={() => confirm('Supprimer ce prospect ?') && run(() => deleteProspect(p.id))}><Trash2 aria-hidden /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title="Prospect">
        <form className="grid gap-3" onSubmit={(ev) => { ev.preventDefault(); run(() => upsertProspect(e), () => setEditing(null)); }}>
          <Field id="pr-n" label="Club"><Input id="pr-n" required value={e.club_name ?? ''} onChange={set('club_name')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="pr-s" label="Sport">
              <Select id="pr-s" value={e.sport_type ?? 'football'} onChange={set('sport_type')}>
                {Object.values(SPORTS_PRESETS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
            <Field id="pr-c" label="Ville"><Input id="pr-c" required value={e.city ?? ''} onChange={set('city')} /></Field>
          </div>
          <Field id="pr-ct" label="Contact"><Input id="pr-ct" value={e.contact_name ?? ''} onChange={set('contact_name')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="pr-ph" label="Téléphone"><Input id="pr-ph" type="tel" value={e.phone ?? ''} onChange={set('phone')} /></Field>
            <Field id="pr-em" label="E-mail"><Input id="pr-em" type="email" value={e.email ?? ''} onChange={set('email')} /></Field>
          </div>
          <Button type="submit" size="lg" disabled={pending}>Enregistrer</Button>
        </form>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

export function AnnouncementsPanel({ announcements }: { announcements: PlatformAnnouncement[] }) {
  const [v, setV] = useState({ title: '', message: '' });
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader title="Annonces aux clubs" description="Affichées en haut de chaque back-office" />
      <CardBody className="grid gap-4">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => createAnnouncement(v), () => setV({ title: '', message: '' })); }}>
          <Field id="an-t" label="Titre"><Input id="an-t" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field id="an-m" label="Message"><Textarea id="an-m" required value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></Field>
          <Button type="submit" disabled={pending}>Publier</Button>
        </form>
        <ul className="divide-y rounded-lg border">
          {announcements.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 p-3">
              <p className="min-w-0"><span className="font-medium">{a.title}</span> <span className="text-sm text-muted-foreground">{a.message}</span></p>
              <Button size="sm" variant={a.is_active ? 'outline' : 'secondary'} onClick={() => run(() => toggleAnnouncement(a.id, !a.is_active))}>{a.is_active ? 'Masquer' : 'Afficher'}</Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Import CSV (Footclubs, Ten'Up, tableur)
// ---------------------------------------------------------------------------

type Mapped = { firstName: string; lastName: string; birthDate: string; gender: 'M' | 'F' | 'X'; email: string; phone: string; address: string; postalCode: string; city: string };

const HEADER_ALIASES: Record<keyof Mapped, string[]> = {
  firstName: ['prenom', 'prénom', 'first name', 'firstname'],
  lastName: ['nom', 'nom de famille', 'last name', 'lastname', 'nom usage'],
  birthDate: ['date de naissance', 'naissance', 'ne le', 'né le', 'date naissance', 'birth date', 'birthdate'],
  gender: ['sexe', 'genre', 'civilite', 'civilité', 'gender'],
  email: ['email', 'e-mail', 'mail', 'courriel', 'email representant legal', 'email 1'],
  phone: ['telephone', 'téléphone', 'portable', 'mobile', 'tel', 'téléphone portable'],
  address: ['adresse', 'adresse 1', 'rue', 'address'],
  postalCode: ['code postal', 'cp', 'postal code'],
  city: ['ville', 'commune', 'localite', 'localité', 'city'],
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function toIsoDate(raw: string): string {
  const s = raw.trim();
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
}

function toGender(raw: string): 'M' | 'F' | 'X' {
  const g = norm(raw);
  if (['m', 'h', 'masculin', 'homme', 'garcon', 'mr', 'm.'].includes(g)) return 'M';
  if (['f', 'feminin', 'femme', 'fille', 'mme', 'mlle'].includes(g)) return 'F';
  return 'X';
}

export function CsvImporter({ clubs }: { clubs: { id: string; name: string }[] }) {
  const [clubId, setClubId] = useState(clubs[0]?.id ?? '');
  const [rows, setRows] = useState<Mapped[]>([]);
  const [columns, setColumns] = useState<Partial<Record<keyof Mapped, string>>>({});
  const [report, setReport] = useState<{ imported: number; skipped: { line: number; reason: string }[] } | null>(null);
  const { pending, run } = useAction();

  function onFile(file?: File) {
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
      complete: (result) => {
        const headers = result.meta.fields ?? [];
        const found: Partial<Record<keyof Mapped, string>> = {};
        (Object.keys(HEADER_ALIASES) as (keyof Mapped)[]).forEach((k) => {
          found[k] = headers.find((h) => HEADER_ALIASES[k].includes(norm(h)));
        });
        setColumns(found);
        setRows(
          result.data.map((r) => ({
            firstName: (found.firstName && r[found.firstName]) || '',
            lastName: (found.lastName && r[found.lastName]) || '',
            birthDate: toIsoDate((found.birthDate && r[found.birthDate]) || ''),
            gender: toGender((found.gender && r[found.gender]) || ''),
            email: (found.email && r[found.email]) || '',
            phone: (found.phone && r[found.phone]) || '',
            address: (found.address && r[found.address]) || '',
            postalCode: (found.postalCode && r[found.postalCode]) || '',
            city: (found.city && r[found.city]) || '',
          })),
        );
        setReport(null);
        if (result.errors.length) toast.warning(`${result.errors.length} ligne(s) mal formée(s) ignorée(s) par la lecture.`);
      },
      error: () => toast.error('Fichier illisible. Enregistrez-le au format CSV (UTF-8) depuis Excel.'),
    });
  }

  const missing = (['firstName', 'lastName', 'birthDate'] as const).filter((k) => !columns[k]);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="1. Fichier" description="Export Footclubs, Ten'Up ou tableur, enregistré en CSV. Colonnes reconnues : Nom, Prénom, Date de naissance, Sexe, E-mail, Téléphone, Adresse, Code postal, Ville." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="im-c" label="Club de destination">
            <Select id="im-c" value={clubId} onChange={(e) => setClubId(e.target.value)}>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field id="im-f" label="Fichier CSV"><Input id="im-f" type="file" accept=".csv,text/csv" className="py-2" onChange={(e) => onFile(e.target.files?.[0])} /></Field>
        </CardBody>
      </Card>
      {rows.length ? (
        <Card>
          <CardHeader title={`2. Vérification - ${rows.length} ligne(s)`} description={missing.length ? `Colonnes introuvables : ${missing.join(', ')}` : 'Colonnes reconnues. Aperçu des 10 premières lignes.'} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b text-left">{['Nom', 'Prénom', 'Naissance', 'Sexe', 'E-mail', 'Ville'].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="p-2">{r.lastName}</td><td className="p-2">{r.firstName}</td><td className="p-2">{r.birthDate || <Badge tone="danger">?</Badge>}</td><td className="p-2">{r.gender}</td><td className="p-2">{r.email}</td><td className="p-2">{r.city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardBody>
            <Button
              size="lg"
              disabled={pending || missing.length > 0 || !clubId}
              onClick={() =>
                run(async () => {
                  const res = await importMembers(clubId, rows);
                  if (res.ok && res.data) setReport(res.data);
                  return res;
                })
              }
            >
              {pending ? 'Import…' : `Importer ${rows.length} adhérent(s)`}
            </Button>
          </CardBody>
        </Card>
      ) : null}
      {report ? (
        <Card>
          <CardHeader title="3. Résultat" description={`${report.imported} importé(s), ${report.skipped.length} ignoré(s)`} />
          {report.skipped.length ? (
            <ul className="max-h-64 divide-y overflow-y-auto text-sm">
              {report.skipped.map((s) => <li key={s.line} className="p-2">Ligne {s.line} : {s.reason}</li>)}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
