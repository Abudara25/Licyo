import { Document, Page, Text, View } from '@react-pdf/renderer';
import { BrandHeader, TableRow, baseStyles, euros, frDate } from './shared';

export type QuoteData = {
  quoteNumber: string;
  date: Date;
  clubName: string;
  contactName?: string | null;
  city: string;
  email?: string | null;
  planName: string;
  monthlyPrice: number;
  features: readonly string[];
  setupFee: number;
};

const VAT_RATE = 0.2;

/** Devis d'abonnement à la plateforme, téléchargeable depuis /tarifs ou le CRM. */
export function QuoteSaasPdf({ data }: { data: QuoteData }) {
  const yearly = data.monthlyPrice * 12;
  const totalHt = yearly + data.setupFee;
  const vat = Math.round(totalHt * VAT_RATE * 100) / 100;
  const validUntil = new Date(data.date.getTime() + 30 * 24 * 3600 * 1000);
  const widths = ['55%', '15%', '15%', '15%'];
  return (
    <Document title={`Devis ${data.quoteNumber}`} author="Licyo">
      <Page size="A4" style={baseStyles.page}>
        <BrandHeader name="Licyo" color="#18181B" lines={['Sites et gestion pour clubs sportifs', process.env.PLATFORM_CONTACT_EMAIL ?? `contact@${(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'licyo.fr').replace(/:\d+$/, '')}`]} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Text style={baseStyles.h1}>Devis n° {data.quoteNumber}</Text>
            <Text style={baseStyles.muted}>Émis le {frDate(data.date)} - valable jusqu'au {frDate(validUntil)}</Text>
          </View>
          <View style={{ textAlign: 'right' }}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>{data.clubName}</Text>
            {data.contactName ? <Text>{data.contactName}</Text> : null}
            <Text>{data.city}</Text>
            {data.email ? <Text>{data.email}</Text> : null}
          </View>
        </View>

        <Text style={baseStyles.h2}>Détail</Text>
        <TableRow header widths={widths} cells={['Désignation', 'Quantité', 'Prix unitaire HT', 'Total HT']} />
        <TableRow widths={widths} cells={[`Abonnement ${data.planName} (mensuel)`, '12 mois', euros(data.monthlyPrice), euros(yearly)]} />
        {data.setupFee > 0 ? (
          <TableRow widths={widths} cells={['Mise en place et reprise des données', '1', euros(data.setupFee), euros(data.setupFee)]} />
        ) : null}

        <View style={{ alignSelf: 'flex-end', width: '45%', marginTop: 12 }}>
          <TableRow widths={['60%', '40%']} cells={['Total HT', euros(totalHt)]} />
          <TableRow widths={['60%', '40%']} cells={['TVA 20 %', euros(vat)]} />
          <TableRow header widths={['60%', '40%']} cells={['Total TTC', euros(totalHt + vat)]} />
        </View>

        <Text style={baseStyles.h2}>Inclus dans l'offre {data.planName}</Text>
        {data.features.map((f) => (
          <Text key={f}>• {f}</Text>
        ))}

        <Text style={baseStyles.h2}>Conditions</Text>
        <Text>Abonnement sans engagement au-delà de la première année, résiliable à chaque échéance. Paiement par prélèvement ou carte. Données hébergées dans l'Union européenne.</Text>

        <View style={{ marginTop: 30, flexDirection: 'row', justifyContent: 'flex-end' }}>
          <View style={{ width: '45%', borderWidth: 0.5, borderColor: '#A1A1AA', padding: 10, height: 70 }}>
            <Text style={baseStyles.muted}>Bon pour accord, date et signature :</Text>
          </View>
        </View>
        <Text style={baseStyles.footer} fixed>Licyo - devis {data.quoteNumber}</Text>
      </Page>
    </Document>
  );
}
