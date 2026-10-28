import { Document, Page, Text, View } from '@react-pdf/renderer';
import { BrandHeader, TableRow, baseStyles, euros, frDate } from './shared';

export type AgReportData = {
  club: { name: string; primary_color: string; logo_url: string | null; city: string; postal_code: string; rna_number: string | null; siret_number: string | null };
  season: string;
  generatedAt: Date;
  totals: { members: number; minors: number; adults: number; female: number; male: number; other: number };
  residents: { count: number; percent: number };
  byCategory: { name: string; count: number }[];
  byCity: { city: string; count: number }[];
  receiptsByMethod: { label: string; amount: number; count: number }[];
  receipts: { date: string; reference: string; payer: string; method: string; amount: number }[];
  totalReceipts: number;
};

const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 1000) / 10} %` : '0 %');

/** Bilan de saison pour l'assemblée générale et les dossiers de subvention municipale. */
export function AgMunicipalityReportPdf({ data }: { data: AgReportData }) {
  const t = data.totals;
  return (
    <Document title={`Bilan ${data.season} - ${data.club.name}`} author={data.club.name}>
      <Page size="A4" style={baseStyles.page}>
        <BrandHeader
          name={data.club.name}
          color={data.club.primary_color}
          logoUrl={data.club.logo_url}
          lines={[`${data.club.postal_code} ${data.club.city}`, [data.club.rna_number && `RNA ${data.club.rna_number}`, data.club.siret_number && `SIRET ${data.club.siret_number}`].filter(Boolean).join(' - ')]}
        />
        <Text style={baseStyles.h1}>Bilan de la saison {data.season}</Text>
        <Text style={baseStyles.muted}>Document établi le {frDate(data.generatedAt)} pour l'assemblée générale et la commune de {data.club.city}.</Text>

        <Text style={baseStyles.h2}>Adhérents</Text>
        <TableRow header widths={['60%', '20%', '20%']} cells={['Indicateur', 'Nombre', 'Part']} />
        <TableRow widths={['60%', '20%', '20%']} cells={['Adhérents validés', String(t.members), '100 %']} />
        <TableRow widths={['60%', '20%', '20%']} cells={['Mineurs', String(t.minors), pct(t.minors, t.members)]} />
        <TableRow widths={['60%', '20%', '20%']} cells={['Majeurs', String(t.adults), pct(t.adults, t.members)]} />
        <TableRow widths={['60%', '20%', '20%']} cells={['Féminines', String(t.female), pct(t.female, t.members)]} />
        <TableRow widths={['60%', '20%', '20%']} cells={['Masculins', String(t.male), pct(t.male, t.members)]} />
        {t.other > 0 ? <TableRow widths={['60%', '20%', '20%']} cells={['Non précisé', String(t.other), pct(t.other, t.members)]} /> : null}
        <TableRow header widths={['60%', '20%', '20%']} cells={[`Habitant ${data.club.city}`, String(data.residents.count), `${data.residents.percent} %`]} />

        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={baseStyles.h2}>Par section</Text>
            {data.byCategory.map((c) => (
              <TableRow key={c.name} widths={['75%', '25%']} cells={[c.name, String(c.count)]} />
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={baseStyles.h2}>Par commune de résidence</Text>
            {data.byCity.slice(0, 12).map((c) => (
              <TableRow key={c.city} widths={['75%', '25%']} cells={[c.city, String(c.count)]} />
            ))}
          </View>
        </View>

        <Text style={baseStyles.h2}>Recettes de cotisations par mode de paiement</Text>
        <TableRow header widths={['50%', '20%', '30%']} cells={['Mode', 'Opérations', 'Montant']} />
        {data.receiptsByMethod.map((r) => (
          <TableRow key={r.label} widths={['50%', '20%', '30%']} cells={[r.label, String(r.count), euros(r.amount)]} />
        ))}
        <TableRow header widths={['50%', '20%', '30%']} cells={['Total encaissé', '', euros(data.totalReceipts)]} />
        <Text style={baseStyles.footer} fixed render={({ pageNumber, totalPages }) => `${data.club.name} - bilan ${data.season} - page ${pageNumber}/${totalPages}`} />
      </Page>

      <Page size="A4" style={baseStyles.page}>
        <Text style={baseStyles.h1}>Livre des recettes - saison {data.season}</Text>
        <TableRow header widths={['14%', '18%', '33%', '17%', '18%']} cells={['Date', 'Référence', 'Payeur', 'Mode', 'Montant']} />
        {data.receipts.map((r, i) => (
          <TableRow key={i} widths={['14%', '18%', '33%', '17%', '18%']} cells={[new Date(r.date).toLocaleDateString('fr-FR'), r.reference, r.payer, r.method, euros(r.amount)]} />
        ))}
        <TableRow header widths={['82%', '18%']} cells={['Total', euros(data.totalReceipts)]} />
        <Text style={baseStyles.footer} fixed render={({ pageNumber, totalPages }) => `${data.club.name} - bilan ${data.season} - page ${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
}
