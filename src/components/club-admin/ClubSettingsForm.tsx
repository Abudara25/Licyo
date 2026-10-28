'use client';

import { useState } from 'react';
import { updateClubSettings } from '@/actions/club-admin.actions';
import { SPORTS_PRESETS } from '@/config/sports-presets';
import { readableTextColor } from '@/lib/utils/color-contrast';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import type { Club } from '@/types/database';
import { useAction } from './useAction';

export function ClubSettingsForm({ club }: { club: Club }) {
  const [v, setV] = useState({
    name: club.name,
    sport_type: club.sport_type,
    primary_color: club.primary_color,
    secondary_color: club.secondary_color,
    city: club.city,
    postal_code: club.postal_code,
    nearby_cities: club.nearby_cities.join(', '),
    contact_email: club.contact_email,
    contact_phone: club.contact_phone ?? '',
    rna_number: club.rna_number ?? '',
    siret_number: club.siret_number ?? '',
    federation_name: club.federation_name ?? '',
    affiliation_number: club.affiliation_number ?? '',
    facebook: club.social_links?.facebook ?? '',
    instagram: club.social_links?.instagram ?? '',
    whatsapp: club.social_links?.whatsapp ?? '',
    current_season: club.current_season,
    sibling_enabled: club.sibling_discount_rules.enabled,
    second_member_discount: String(club.sibling_discount_rules.second_member_discount),
    third_member_discount: String(club.sibling_discount_rules.third_member_discount),
    discount_type: club.sibling_discount_rules.discount_type,
    accepts_pass_sport: club.accepts_pass_sport,
    pass_sport_amount: String(club.pass_sport_amount),
    accepts_caf_aids: club.accepts_caf_aids,
    accepts_installments: club.accepts_installments,
    pass_stripe_fees_to_parents: club.pass_stripe_fees_to_parents,
    modules: {
      inscriptions: club.enabled_modules.inscriptions,
      trials: club.enabled_modules.trials,
      payments: club.enabled_modules.payments,
      boutique: club.enabled_modules.boutique,
      attendance: club.enabled_modules.attendance,
      sponsors: club.enabled_modules.sponsors,
      social_generator: club.enabled_modules.social_generator,
    },
  });
  const { pending, run } = useAction();
  const set = <K extends keyof typeof v>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const mod = (k: keyof typeof v.modules) => (val: boolean) => setV({ ...v, modules: { ...v.modules, [k]: val } });
  const year = Number(club.current_season.slice(0, 4));

  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => updateClubSettings(v)); }} className="grid gap-6">
      <Card>
        <CardHeader title="Identité du club" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="st-n" label="Nom du club"><Input id="st-n" required value={v.name} onChange={set('name')} /></Field>
          <Field id="st-sp" label="Sport">
            <Select id="st-sp" value={v.sport_type} onChange={set('sport_type')}>
              {Object.values(SPORTS_PRESETS).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </Field>
          {(['primary_color', 'secondary_color'] as const).map((k) => (
            <Field key={k} id={`st-${k}`} label={k === 'primary_color' ? 'Couleur principale' : 'Couleur secondaire'}>
              <div className="flex items-center gap-2">
                <input aria-label="Sélecteur de couleur" type="color" value={v[k]} onChange={set(k)} className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border" />
                <Input id={`st-${k}`} value={v[k]} onChange={set(k)} pattern="#[0-9A-Fa-f]{6}" />
                <span className="flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold" style={{ background: v[k], color: readableTextColor(v[k]) }}>Aa</span>
              </div>
            </Field>
          ))}
          <Field id="st-ci" label="Ville"><Input id="st-ci" required value={v.city} onChange={set('city')} /></Field>
          <Field id="st-pc" label="Code postal"><Input id="st-pc" required inputMode="numeric" maxLength={5} value={v.postal_code} onChange={set('postal_code')} /></Field>
          <Field id="st-nc" label="Communes voisines desservies" hint="Séparées par des virgules : améliore le référencement local." className="sm:col-span-2"><Input id="st-nc" value={v.nearby_cities} onChange={set('nearby_cities')} /></Field>
          <Field id="st-em" label="E-mail de contact"><Input id="st-em" type="email" required value={v.contact_email} onChange={set('contact_email')} /></Field>
          <Field id="st-ph" label="Téléphone"><Input id="st-ph" type="tel" value={v.contact_phone} onChange={set('contact_phone')} /></Field>
          <Field id="st-rna" label="N° RNA"><Input id="st-rna" value={v.rna_number} onChange={set('rna_number')} placeholder="W951234567" /></Field>
          <Field id="st-sir" label="N° SIRET"><Input id="st-sir" inputMode="numeric" value={v.siret_number} onChange={set('siret_number')} /></Field>
          <Field id="st-fed" label="Fédération"><Input id="st-fed" value={v.federation_name} onChange={set('federation_name')} /></Field>
          <Field id="st-aff" label="N° d'affiliation"><Input id="st-aff" value={v.affiliation_number} onChange={set('affiliation_number')} /></Field>
          <Field id="st-fb" label="Facebook (lien)"><Input id="st-fb" type="url" value={v.facebook} onChange={set('facebook')} /></Field>
          <Field id="st-ig" label="Instagram (lien)"><Input id="st-ig" type="url" value={v.instagram} onChange={set('instagram')} /></Field>
          <Field id="st-wa" label="WhatsApp (lien de groupe)"><Input id="st-wa" type="url" value={v.whatsapp} onChange={set('whatsapp')} /></Field>
          <Field id="st-se" label="Saison en cours">
            <Select id="st-se" value={v.current_season} onChange={set('current_season')}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={`${y}-${y + 1}`}>{y}-{y + 1}</option>)}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tarifs, aides et paiements" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Checkbox id="st-sib" checked={v.sibling_enabled} onChange={(b) => setV({ ...v, sibling_enabled: b })} label="Remise famille (frères, sœurs, parents)" /></div>
          {v.sibling_enabled ? (
            <>
              <Field id="st-dt" label="Type de remise">
                <Select id="st-dt" value={v.discount_type} onChange={set('discount_type')}>
                  <option value="fixed_euros">Montant en euros</option><option value="percent">Pourcentage</option>
                </Select>
              </Field>
              <span className="hidden sm:block" />
              <Field id="st-d2" label="Remise 2e personne"><Input id="st-d2" type="number" min="0" inputMode="decimal" value={v.second_member_discount} onChange={set('second_member_discount')} /></Field>
              <Field id="st-d3" label="Remise 3e personne et suivantes"><Input id="st-d3" type="number" min="0" inputMode="decimal" value={v.third_member_discount} onChange={set('third_member_discount')} /></Field>
            </>
          ) : null}
          <Checkbox id="st-ps" checked={v.accepts_pass_sport} onChange={(b) => setV({ ...v, accepts_pass_sport: b })} label="Pass'Sport accepté" />
          {v.accepts_pass_sport ? <Field id="st-psa" label="Montant du Pass'Sport (€)"><Input id="st-psa" type="number" min="0" inputMode="decimal" value={v.pass_sport_amount} onChange={set('pass_sport_amount')} /></Field> : <span />}
          <Checkbox id="st-caf" checked={v.accepts_caf_aids} onChange={(b) => setV({ ...v, accepts_caf_aids: b })} label="Aides CAF et coupons acceptés" />
          <Checkbox id="st-ins" checked={v.accepts_installments} onChange={(b) => setV({ ...v, accepts_installments: b })} label="Paiement en 3 chèques" />
          <div className="sm:col-span-2">
            <Checkbox id="st-fee" checked={v.pass_stripe_fees_to_parents} onChange={(b) => setV({ ...v, pass_stripe_fees_to_parents: b })} label="Faire payer les frais de carte bancaire aux familles" description="1,5 % + 0,25 € ajoutés au total : le club reçoit la cotisation entière." />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Modules" description="Activez seulement ce dont le club a besoin" />
        <CardBody className="grid gap-1 sm:grid-cols-2">
          <Checkbox id="m-ins" checked={v.modules.inscriptions} onChange={mod('inscriptions')} label="Inscriptions en ligne" />
          <Checkbox id="m-tri" checked={v.modules.trials} onChange={mod('trials')} label="Séances d'essai" />
          <Checkbox id="m-pay" checked={v.modules.payments} onChange={mod('payments')} label="Paiement par carte" description={club.subscription_plan !== 'integral' ? 'Inclus dans l\'offre Intégral' : undefined} />
          <Checkbox id="m-bou" checked={v.modules.boutique} onChange={mod('boutique')} label="Boutique d'équipements" />
          <Checkbox id="m-att" checked={v.modules.attendance} onChange={mod('attendance')} label="Feuilles d'appel" />
          <Checkbox id="m-spo" checked={v.modules.sponsors} onChange={mod('sponsors')} label="Page partenaires" />
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-zinc-50/95 px-4 py-3 backdrop-blur safe-bottom md:mx-0 md:rounded-xl md:border">
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>{pending ? 'Enregistrement…' : 'Enregistrer les paramètres'}</Button>
      </div>
    </form>
  );
}
