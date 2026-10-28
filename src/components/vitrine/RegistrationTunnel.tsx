'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Upload } from 'lucide-react';
import { submitRegistration } from '@/actions/public-club.actions';
import { ageOn, categoriesForBirthYear } from '@/lib/age';
import { computeCart, formatEuros } from '@/lib/pricing';
import { compressImage } from '@/lib/utils/image-compression';
import { Field, Input, Select, Checkbox } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { TactileSignaturePad } from './TactileSignaturePad';
import type { SportVocabulary } from '@/config/sports-presets';
import type { Category, Club, ClubProduct } from '@/types/database';

type DocKind = 'photo' | 'medical' | 'id';
type MemberDraft = {
  key: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: 'M' | 'F' | 'X';
  categoryId: string;
  healthQuestionnairePassed: boolean;
  passSportCode: string;
  consentImageRights: boolean;
  consentEmergencyMedical: boolean;
  consentAutonomousExit: boolean;
  products: { productId: string; size: string }[];
  files: Partial<Record<DocKind, File>>;
};

export type TunnelClub = Pick<
  Club,
  | 'slug'
  | 'name'
  | 'current_season'
  | 'sibling_discount_rules'
  | 'accepts_pass_sport'
  | 'pass_sport_amount'
  | 'accepts_installments'
  | 'pass_stripe_fees_to_parents'
  | 'enabled_modules'
  | 'stripe_connect_onboarded'
>;

export type TunnelPrefill = {
  renewalToken?: string;
  members?: Partial<MemberDraft>[];
  payer?: Partial<Payer>;
  emergency?: { name: string; phone: string };
};

type Payer = { firstName: string; lastName: string; email: string; phone: string; address: string; postalCode: string; city: string };

const newMember = (seed: Partial<MemberDraft> = {}): MemberDraft => ({
  key: Math.random().toString(36).slice(2),
  firstName: '',
  lastName: '',
  birthDate: '',
  gender: 'X',
  categoryId: '',
  healthQuestionnairePassed: true,
  passSportCode: '',
  consentImageRights: false,
  consentEmergencyMedical: true,
  consentAutonomousExit: false,
  products: [],
  files: {},
  ...seed,
});

const DOC_LABELS: Record<DocKind, string> = { photo: 'Photo d\'identité', medical: 'Certificat médical', id: 'Pièce d\'identité' };

export function RegistrationTunnel({
  club,
  categories,
  products,
  vocab,
  prefill,
}: {
  club: TunnelClub;
  categories: Category[];
  products: ClubProduct[];
  vocab: SportVocabulary;
  prefill?: TunnelPrefill;
}) {
  const [step, setStep] = useState(1);
  const [members, setMembers] = useState<MemberDraft[]>(() => (prefill?.members?.length ? prefill.members.map(newMember) : [newMember()]));
  const [payer, setPayer] = useState<Payer>({ firstName: '', lastName: '', email: '', phone: '', address: '', postalCode: '', city: '', ...prefill?.payer });
  const [emergency, setEmergency] = useState(prefill?.emergency ?? { name: '', phone: '' });
  const canPayByCard = club.enabled_modules.payments && club.stripe_connect_onboarded;
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'check' | 'cash' | 'transfer'>(canPayByCard ? 'card' : 'check');
  const [installmentsCount, setInstallmentsCount] = useState(1);
  const [acceptRules, setAcceptRules] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ages = members.map((m) => (m.birthDate ? ageOn(m.birthDate) : NaN));
  const isAdultSelf = members.length === 1 && ages[0] >= 18;

  const totals = useMemo(() => {
    const cart = members.map((m, i) => {
      const cat = categories.find((c) => c.id === m.categoryId);
      return {
        licensePrice: cat ? Number(cat.annual_price) : 0,
        usesPassSport: club.accepts_pass_sport && Boolean(m.passSportCode) && ages[i] >= 6 && ages[i] <= 30,
        products: m.products.map((p) => ({ price: Number(products.find((x) => x.id === p.productId)?.price ?? 0) })),
      };
    });
    return computeCart(
      cart,
      {
        siblingDiscount: club.sibling_discount_rules,
        acceptsPassSport: club.accepts_pass_sport,
        passSportAmount: Number(club.pass_sport_amount),
        passStripeFeesToParents: club.pass_stripe_fees_to_parents,
      },
      paymentMethod === 'card',
    );
  }, [members, categories, products, club, paymentMethod, ages]);

  const update = (key: string, patch: Partial<MemberDraft>) => setMembers((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  async function attachFile(key: string, kind: DocKind, file: File | undefined) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Fichier trop lourd (15 Mo maximum avant compression).');
      return;
    }
    const prepared = file.type.startsWith('image/') ? await compressImage(file) : file;
    if (prepared.size > 5 * 1024 * 1024) {
      toast.error('Fichier trop lourd (5 Mo maximum).');
      return;
    }
    setMembers((list) => list.map((m) => (m.key === key ? { ...m, files: { ...m.files, [kind]: prepared } } : m)));
  }

  function validateStep(n: number): string | null {
    if (n === 1) {
      for (const [i, m] of members.entries()) {
        const who = m.firstName || `la personne ${i + 1}`;
        if (!m.firstName.trim() || !m.lastName.trim()) return `Nom et prénom de ${who} obligatoires.`;
        if (!m.birthDate || Number.isNaN(ages[i])) return `Date de naissance de ${who} obligatoire.`;
        if (!m.categoryId) return `Choisissez le groupe de ${who}.`;
        const cat = categories.find((c) => c.id === m.categoryId);
        if (cat && cat.medical_requirement !== 'health_questionnaire' && !m.files.medical) return `Certificat médical requis pour ${who}.`;
        if (cat && cat.medical_requirement === 'health_questionnaire' && !m.healthQuestionnairePassed && !m.files.medical) {
          return `Si une réponse au questionnaire de santé est « oui », joignez un certificat médical pour ${who}.`;
        }
      }
    }
    if (n === 2) {
      const p = isAdultSelf ? { ...payer, firstName: members[0].firstName, lastName: members[0].lastName } : payer;
      if (!p.firstName || !p.lastName || !p.email || !p.phone || !p.address || !p.postalCode || !p.city) return 'Complétez toutes les coordonnées.';
      if (!emergency.name || !emergency.phone) return 'Indiquez un contact en cas d\'urgence.';
    }
    if (n === 3) {
      if (!acceptRules) return 'Vous devez accepter le règlement intérieur.';
      if (!signature) return 'La signature est obligatoire.';
    }
    return null;
  }

  function next() {
    const problem = validateStep(step);
    setError(problem);
    if (!problem) {
      setStep((s) => s + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function submit() {
    const problem = validateStep(3);
    setError(problem);
    if (problem) return;
    const finalPayer = isAdultSelf ? { ...payer, firstName: members[0].firstName, lastName: members[0].lastName } : payer;
    const payload = {
      clubSlug: club.slug,
      renewalToken: prefill?.renewalToken,
      payer: finalPayer,
      emergency,
      isAdultSelfRegistration: isAdultSelf,
      members: members.map((m) => ({
        firstName: m.firstName,
        lastName: m.lastName,
        birthDate: m.birthDate,
        gender: m.gender,
        categoryId: m.categoryId,
        healthQuestionnairePassed: m.healthQuestionnairePassed,
        passSportCode: m.passSportCode,
        consentImageRights: m.consentImageRights,
        consentEmergencyMedical: m.consentEmergencyMedical,
        consentAutonomousExit: m.consentAutonomousExit,
        signatureDataUrl: signature,
        products: m.products.filter((p) => p.productId && p.size),
      })),
      paymentMethod,
      installmentsCount,
      acceptRules,
    };
    const fd = new FormData();
    fd.set('payload', JSON.stringify(payload));
    members.forEach((m, i) => (Object.entries(m.files) as [DocKind, File][]).forEach(([kind, file]) => fd.set(`${kind}_${i}`, file)));
    startTransition(async () => {
      const res = await submitRegistration(fd);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      if (res.data?.redirectUrl) {
        window.location.href = res.data.redirectUrl;
        return;
      }
      setStep(4);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (step === 4) {
    return (
      <div role="status" className="rounded-2xl border bg-white p-6 text-center">
        <p className="text-2xl font-bold">Dossier envoyé</p>
        <p className="mt-2 text-muted-foreground">Un e-mail récapitulatif a été envoyé à {payer.email}. Le club vous contacte si une pièce manque.</p>
      </div>
    );
  }

  const steps = ['Adhérents', isAdultSelf ? 'Vos coordonnées' : 'Responsable', 'Paiement et signature'];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Étapes">
          {steps.map((label, i) => (
            <li key={label} aria-current={step === i + 1 ? 'step' : undefined} className={`rounded-lg border px-2 py-2 text-center text-xs font-semibold sm:text-sm ${step === i + 1 ? 'border-club-primary bg-club-primary text-club-primary-fg' : step > i + 1 ? 'bg-muted' : ''}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {error ? (
          <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-red-50 p-3 text-sm text-red-900">{error}</p>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-6">
            {members.map((m, i) => {
              const age = ages[i];
              const adult = age >= 18;
              const eligible = m.birthDate ? categoriesForBirthYear(categories, Number(m.birthDate.slice(0, 4)), m.gender) : categories;
              const cat = categories.find((c) => c.id === m.categoryId);
              const p = `m${i}`;
              return (
                <fieldset key={m.key} className="rounded-2xl border bg-white p-4 md:p-6">
                  <legend className="px-1 text-lg font-bold">
                    {members.length > 1 ? `Personne ${i + 1}` : 'Adhérent'}
                    {!Number.isNaN(age) && m.birthDate ? <span className="ml-2 text-sm font-normal text-muted-foreground">{age} ans - {adult ? 'adulte' : 'mineur'}</span> : null}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id={`${p}-fn`} label="Prénom"><Input id={`${p}-fn`} autoComplete="off" value={m.firstName} onChange={(e) => update(m.key, { firstName: e.target.value })} /></Field>
                    <Field id={`${p}-ln`} label="Nom"><Input id={`${p}-ln`} autoComplete="off" value={m.lastName} onChange={(e) => update(m.key, { lastName: e.target.value })} /></Field>
                    <Field id={`${p}-bd`} label="Date de naissance"><Input id={`${p}-bd`} type="date" value={m.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => update(m.key, { birthDate: e.target.value, categoryId: '' })} /></Field>
                    <Field id={`${p}-g`} label="Genre">
                      <Select id={`${p}-g`} value={m.gender} onChange={(e) => update(m.key, { gender: e.target.value as MemberDraft['gender'], categoryId: '' })}>
                        <option value="X">Non précisé</option>
                        <option value="F">Féminin</option>
                        <option value="M">Masculin</option>
                      </Select>
                    </Field>
                    <Field id={`${p}-cat`} label={`Groupe (${vocab.group})`} className="sm:col-span-2" hint={m.birthDate && eligible.length === 0 ? 'Aucun groupe pour cet âge : contactez le club.' : undefined}>
                      <Select id={`${p}-cat`} value={m.categoryId} onChange={(e) => update(m.key, { categoryId: e.target.value })} disabled={!m.birthDate}>
                        <option value="">{m.birthDate ? 'Choisir…' : 'Renseignez d\'abord la date de naissance'}</option>
                        {eligible.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} - {formatEuros(Number(c.annual_price))}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <div className="mt-4 grid gap-1 border-t pt-4">
                    {(!cat || cat.medical_requirement === 'health_questionnaire') ? (
                      <Checkbox
                        id={`${p}-hq`}
                        checked={m.healthQuestionnairePassed}
                        onChange={(v) => update(m.key, { healthQuestionnairePassed: v })}
                        label={adult ? 'J\'ai répondu « non » à toutes les questions du questionnaire de santé.' : 'Mon enfant et moi avons répondu « non » à toutes les questions du questionnaire de santé.'}
                        description="Si une réponse est « oui », décochez et joignez un certificat médical."
                      />
                    ) : null}
                    {club.accepts_pass_sport && age >= 6 && age <= 30 ? (
                      <Field id={`${p}-ps`} label={`Code Pass'Sport (facultatif, -${formatEuros(Number(club.pass_sport_amount))})`} className="mt-2">
                        <Input id={`${p}-ps`} inputMode="text" autoCapitalize="characters" value={m.passSportCode} onChange={(e) => update(m.key, { passSportCode: e.target.value.toUpperCase() })} />
                      </Field>
                    ) : null}
                    <Checkbox id={`${p}-img`} checked={m.consentImageRights} onChange={(v) => update(m.key, { consentImageRights: v })} label="J'autorise le club à publier des photos sur son site et ses réseaux." />
                    <Checkbox id={`${p}-med`} checked={m.consentEmergencyMedical} onChange={(v) => update(m.key, { consentEmergencyMedical: v })} label={adult ? 'J\'autorise les secours à me prendre en charge en cas d\'urgence.' : 'J\'autorise le club à faire appel aux secours et à faire soigner mon enfant en cas d\'urgence.'} />
                    {!adult ? (
                      <Checkbox id={`${p}-exit`} checked={m.consentAutonomousExit} onChange={(v) => update(m.key, { consentAutonomousExit: v })} label="Mon enfant peut repartir seul après l'activité." />
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
                    {(['photo', 'medical', 'id'] as DocKind[]).map((kind) => {
                      const required = kind === 'medical' && cat && (cat.medical_requirement !== 'health_questionnaire' || !m.healthQuestionnairePassed);
                      return (
                        <label key={kind} htmlFor={`${p}-${kind}`} className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-3 text-center text-sm hover:bg-muted">
                          <Upload className="size-5" aria-hidden />
                          <span className="font-medium">{DOC_LABELS[kind]}{required ? ' *' : ''}</span>
                          <span className="text-xs text-muted-foreground">{m.files[kind] ? `${m.files[kind]!.name.slice(0, 24)} (${Math.round(m.files[kind]!.size / 1024)} Ko)` : kind === 'photo' ? 'Appareil photo ou galerie' : 'Photo ou PDF'}</span>
                          <input id={`${p}-${kind}`} type="file" className="sr-only" accept={kind === 'photo' ? 'image/*' : 'image/*,application/pdf'} capture={kind === 'photo' ? 'user' : undefined} onChange={(e) => attachFile(m.key, kind, e.target.files?.[0])} />
                        </label>
                      );
                    })}
                  </div>

                  {club.enabled_modules.boutique && products.length > 0 ? (
                    <div className="mt-4 border-t pt-4">
                      <p className="text-sm font-semibold">Équipement (facultatif)</p>
                      <ul className="mt-2 grid gap-2">
                        {products.map((prod) => {
                          const chosen = m.products.find((x) => x.productId === prod.id);
                          return (
                            <li key={prod.id} className="flex flex-wrap items-center gap-3">
                              <label className="flex min-h-11 flex-1 items-center gap-3">
                                <input type="checkbox" className="size-5" checked={Boolean(chosen)} onChange={(e) => update(m.key, { products: e.target.checked ? [...m.products, { productId: prod.id, size: prod.available_sizes[0] ?? '' }] : m.products.filter((x) => x.productId !== prod.id) })} />
                                <span className="text-sm">{prod.name} - {formatEuros(Number(prod.price))}</span>
                              </label>
                              {chosen ? (
                                <Select aria-label={`Taille ${prod.name}`} className="w-32" value={chosen.size} onChange={(e) => update(m.key, { products: m.products.map((x) => (x.productId === prod.id ? { ...x, size: e.target.value } : x)) })}>
                                  {prod.available_sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                                </Select>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {members.length > 1 ? (
                    <Button type="button" variant="ghost" className="mt-3 text-destructive" onClick={() => setMembers((list) => list.filter((x) => x.key !== m.key))}>
                      <Trash2 aria-hidden /> Retirer cette personne
                    </Button>
                  ) : null}
                </fieldset>
              );
            })}
            {members.length < 8 ? (
              <Button type="button" variant="outline" onClick={() => setMembers((list) => [...list, newMember({ lastName: list[0]?.lastName ?? '' })])}>
                <Plus aria-hidden /> Ajouter un frère, une sœur ou un parent
              </Button>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <fieldset className="rounded-2xl border bg-white p-4 md:p-6">
            <legend className="px-1 text-lg font-bold">{isAdultSelf ? 'Vos coordonnées' : 'Parent ou responsable légal'}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {!isAdultSelf ? (
                <>
                  <Field id="p-fn" label="Prénom"><Input id="p-fn" autoComplete="given-name" value={payer.firstName} onChange={(e) => setPayer({ ...payer, firstName: e.target.value })} /></Field>
                  <Field id="p-ln" label="Nom"><Input id="p-ln" autoComplete="family-name" value={payer.lastName} onChange={(e) => setPayer({ ...payer, lastName: e.target.value })} /></Field>
                </>
              ) : null}
              <Field id="p-em" label="E-mail"><Input id="p-em" type="email" autoComplete="email" inputMode="email" value={payer.email} onChange={(e) => setPayer({ ...payer, email: e.target.value })} /></Field>
              <Field id="p-ph" label="Téléphone"><Input id="p-ph" type="tel" autoComplete="tel" inputMode="tel" value={payer.phone} onChange={(e) => setPayer({ ...payer, phone: e.target.value })} /></Field>
              <Field id="p-ad" label="Adresse" className="sm:col-span-2"><Input id="p-ad" autoComplete="street-address" value={payer.address} onChange={(e) => setPayer({ ...payer, address: e.target.value })} /></Field>
              <Field id="p-pc" label="Code postal"><Input id="p-pc" autoComplete="postal-code" inputMode="numeric" maxLength={5} value={payer.postalCode} onChange={(e) => setPayer({ ...payer, postalCode: e.target.value })} /></Field>
              <Field id="p-ci" label="Ville"><Input id="p-ci" autoComplete="address-level2" value={payer.city} onChange={(e) => setPayer({ ...payer, city: e.target.value })} /></Field>
            </div>
            <p className="mt-6 font-semibold">Contact en cas d'urgence</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <Field id="e-n" label="Nom et prénom"><Input id="e-n" value={emergency.name} onChange={(e) => setEmergency({ ...emergency, name: e.target.value })} /></Field>
              <Field id="e-p" label="Téléphone"><Input id="e-p" type="tel" inputMode="tel" value={emergency.phone} onChange={(e) => setEmergency({ ...emergency, phone: e.target.value })} /></Field>
            </div>
          </fieldset>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-6">
            <fieldset className="rounded-2xl border bg-white p-4 md:p-6">
              <legend className="px-1 text-lg font-bold">Mode de paiement</legend>
              <div className="grid gap-2">
                {canPayByCard ? (
                  <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3"><input type="radio" name="pay" className="size-5" checked={paymentMethod === 'card'} onChange={() => setPaymentMethod('card')} /> Carte bancaire (paiement sécurisé immédiat)</label>
                ) : null}
                <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3"><input type="radio" name="pay" className="size-5" checked={paymentMethod === 'check'} onChange={() => setPaymentMethod('check')} /> Chèque(s) à remettre au club</label>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3"><input type="radio" name="pay" className="size-5" checked={paymentMethod === 'transfer'} onChange={() => setPaymentMethod('transfer')} /> Virement</label>
                <label className="flex min-h-12 items-center gap-3 rounded-lg border p-3"><input type="radio" name="pay" className="size-5" checked={paymentMethod === 'cash'} onChange={() => setPaymentMethod('cash')} /> Espèces</label>
              </div>
              {paymentMethod === 'check' && club.accepts_installments ? (
                <Field id="inst" label="Nombre de chèques" className="mt-4" hint="Encaissés début octobre, novembre et décembre.">
                  <Select id="inst" value={installmentsCount} onChange={(e) => setInstallmentsCount(Number(e.target.value))}>
                    <option value={1}>1 chèque</option>
                    <option value={2}>2 chèques</option>
                    <option value={3}>3 chèques</option>
                  </Select>
                </Field>
              ) : null}
            </fieldset>
            <fieldset className="rounded-2xl border bg-white p-4 md:p-6">
              <legend className="px-1 text-lg font-bold">Signature</legend>
              <Checkbox id="rules" checked={acceptRules} onChange={setAcceptRules} label="J'accepte le règlement intérieur du club et certifie l'exactitude des informations." />
              <div className="mt-3">
                <TactileSignaturePad id="sig" label={isAdultSelf ? 'Votre signature' : 'Signature du responsable légal'} onChange={setSignature} />
              </div>
            </fieldset>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-between gap-3">
          {step > 1 ? <Button type="button" variant="outline" onClick={() => setStep((s) => s - 1)} disabled={pending}>Retour</Button> : <span />}
          {step < 3 ? (
            <Button type="button" variant="club" size="lg" onClick={next}>Continuer</Button>
          ) : (
            <Button type="button" variant="club" size="lg" onClick={submit} disabled={pending}>
              {pending ? 'Envoi en cours…' : paymentMethod === 'card' ? `Payer ${formatEuros(totals.finalTotalAmount)}` : 'Envoyer le dossier'}
            </Button>
          )}
        </div>
      </div>

      <aside aria-label="Récapitulatif" className="h-fit rounded-2xl border bg-white p-4 lg:sticky lg:top-24">
        <p className="font-bold">Récapitulatif {club.current_season}</p>
        <dl className="mt-3 grid gap-1.5 text-sm">
          <div className="flex justify-between gap-2"><dt>Cotisations</dt><dd className="tabular-nums">{formatEuros(totals.licensesSubtotal)}</dd></div>
          {totals.productsSubtotal > 0 ? <div className="flex justify-between gap-2"><dt>Équipement</dt><dd className="tabular-nums">{formatEuros(totals.productsSubtotal)}</dd></div> : null}
          {totals.siblingDiscountAmount > 0 ? <div className="flex justify-between gap-2 text-emerald-700"><dt>Remise famille</dt><dd className="tabular-nums">-{formatEuros(totals.siblingDiscountAmount)}</dd></div> : null}
          {totals.aidsDeductionAmount > 0 ? <div className="flex justify-between gap-2 text-emerald-700"><dt>Pass'Sport</dt><dd className="tabular-nums">-{formatEuros(totals.aidsDeductionAmount)}</dd></div> : null}
          {totals.stripeFeeAdded > 0 ? <div className="flex justify-between gap-2 text-muted-foreground"><dt>Frais de paiement en ligne</dt><dd className="tabular-nums">{formatEuros(totals.stripeFeeAdded)}</dd></div> : null}
          <div className="mt-2 flex justify-between gap-2 border-t pt-2 text-base font-bold"><dt>Total</dt><dd className="tabular-nums">{formatEuros(totals.finalTotalAmount)}</dd></div>
        </dl>
        {totals.stripeFeeAdded > 0 ? <p className="mt-2 text-xs text-muted-foreground">Les frais bancaires permettent au club de recevoir l'intégralité de la cotisation. Payez par chèque ou virement pour les éviter.</p> : null}
        <p className="mt-2 text-xs text-muted-foreground">Le montant définitif est recalculé à l'envoi.</p>
      </aside>
    </div>
  );
}
