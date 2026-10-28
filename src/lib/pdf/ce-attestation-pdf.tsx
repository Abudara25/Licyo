import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import type { Club, FamilyRegistration } from '@/types/database';
import { BrandHeader, TableRow, baseStyles, euros, frDate, pdfImageSrc } from './shared';

export type AttestationData = {
  club: Pick<Club, 'name' | 'primary_color' | 'logo_url' | 'rna_number' | 'siret_number' | 'city' | 'postal_code' | 'contact_email' | 'president_name' | 'president_signature_url' | 'federation_name' | 'affiliation_number'>;
  family: Pick<FamilyRegistration, 'payer_first_name' | 'payer_last_name' | 'address' | 'postal_code' | 'city' | 'season' | 'amount_paid' | 'invoice_number' | 'final_total_amount'>;
  members: { fullName: string; birthDate: string; categoryName: string; licensePrice: number }[];
  issuedAt: Date;
};

/** Attestation de paiement de cotisation (CE, mutuelle, employeur). */
export function CeAttestationPdf({ data }: { data: AttestationData }) {
  const { club, family } = data;
  const signature = pdfImageSrc(club.president_signature_url);
  const widths = ['40%', '20%', '25%', '15%'];
  return (
    <Document title={`Attestation ${family.invoice_number ?? ''}`} author={club.name}>
      <Page size="A4" style={baseStyles.page}>
        <BrandHeader
          name={club.name}
          color={club.primary_color}
          logoUrl={club.logo_url}
          lines={[
            `${club.postal_code} ${club.city} - ${club.contact_email}`,
            [club.rna_number && `RNA ${club.rna_number}`, club.siret_number && `SIRET ${club.siret_number}`].filter(Boolean).join(' - '),
            club.federation_name ? `Affilié ${club.federation_name}${club.affiliation_number ? ` n° ${club.affiliation_number}` : ''}` : null,
          ]}
        />
        <Text style={baseStyles.h1}>Attestation de paiement de cotisation</Text>
        <Text style={baseStyles.muted}>Saison {family.season}{family.invoice_number ? ` - référence ${family.invoice_number}` : ''}</Text>

        <Text style={{ marginTop: 16 }}>
          Je soussigné(e), {club.president_name ?? 'le président'}, président(e) de l'association {club.name}, atteste que{' '}
          {family.payer_first_name} {family.payer_last_name}, demeurant {family.address}, {family.postal_code} {family.city},{' '}
          a réglé la somme de {euros(family.amount_paid)}{' '}au titre de la cotisation annuelle pour la saison {family.season}{' '}
          des personnes suivantes :
        </Text>

        <View style={{ marginTop: 12 }}>
          <TableRow header widths={widths} cells={['Adhérent', 'Né(e) le', 'Section', 'Cotisation']} />
          {data.members.map((m) => (
            <TableRow key={m.fullName + m.birthDate} widths={widths} cells={[m.fullName, frDate(m.birthDate), m.categoryName, euros(m.licensePrice)]} />
          ))}
        </View>

        <View style={{ alignSelf: 'flex-end', width: '45%', marginTop: 10 }}>
          <TableRow widths={['60%', '40%']} cells={['Total du dossier', euros(family.final_total_amount)]} />
          <TableRow header widths={['60%', '40%']} cells={['Montant réglé', euros(family.amount_paid)]} />
        </View>

        <Text style={{ marginTop: 16 }}>Attestation délivrée pour faire valoir ce que de droit.</Text>

        <View style={{ marginTop: 24, alignSelf: 'flex-end', width: '45%' }}>
          <Text>Fait à {club.city}, le {frDate(data.issuedAt)}</Text>
          <Text style={{ fontFamily: 'Helvetica-Bold', marginTop: 4 }}>{club.president_name ?? 'Le président'}</Text>
          {signature ? <Image src={signature} style={{ width: 150, height: 60, objectFit: 'contain', marginTop: 6 }} /> : <View style={{ height: 60 }} />}
        </View>
        <Text style={baseStyles.footer} fixed>
          {club.name} - association loi 1901{club.rna_number ? ` - ${club.rna_number}` : ''}
        </Text>
      </Page>
    </Document>
  );
}
