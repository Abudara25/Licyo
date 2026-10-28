import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { readableTextColor, safeHex } from '@/lib/utils/color-contrast';
import { pdfImageSrc, euros } from './shared';

export type PosterData = {
  clubName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  sportLabel: string;
  tagline: string;
  siteUrl: string;
  qrDataUrl: string;
  groupsLabel: string;
  categories: { name: string; ages: string; price: number }[];
  scheduleLines: string[];
};

/** Affiche A4 pour le forum des associations : QR code vers l'inscription en ligne. */
export function ForumPosterPdf({ data }: { data: PosterData }) {
  const primary = safeHex(data.primaryColor);
  const secondary = safeHex(data.secondaryColor, '#FBBF24');
  const fg = readableTextColor(primary);
  const logo = pdfImageSrc(data.logoUrl);
  return (
    <Document title={`Affiche ${data.clubName}`} author={data.clubName}>
      <Page size="A4" style={{ fontFamily: 'Helvetica', backgroundColor: primary, color: fg, padding: 36 }}>
        <View style={{ alignItems: 'center' }}>
          {logo ? <Image src={logo} style={{ width: 90, height: 90, objectFit: 'contain', marginBottom: 10 }} /> : null}
          <Text style={{ fontSize: 30, fontFamily: 'Helvetica-Bold', textAlign: 'center' }}>{data.clubName}</Text>
          <Text style={{ fontSize: 16, marginTop: 6, textAlign: 'center' }}>{data.sportLabel} - {data.tagline}</Text>
        </View>

        <View style={{ backgroundColor: '#FFFFFF', color: '#18181B', borderRadius: 8, padding: 18, marginTop: 24 }}>
          <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>Nos {data.groupsLabel}</Text>
          {data.categories.map((c) => (
            <View key={c.name} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#E4E4E7' }}>
              <Text style={{ fontSize: 11 }}>{c.name} ({c.ages})</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold' }}>{euros(c.price)} / an</Text>
            </View>
          ))}
          {data.scheduleLines.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              {data.scheduleLines.slice(0, 8).map((l) => (
                <Text key={l} style={{ fontSize: 9.5, color: '#52525B' }}>{l}</Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, backgroundColor: secondary, borderRadius: 8, padding: 18 }}>
          <Image src={data.qrDataUrl} style={{ width: 150, height: 150, backgroundColor: '#FFFFFF', padding: 6 }} />
          <View style={{ marginLeft: 18, flex: 1, color: readableTextColor(secondary) }}>
            <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold' }}>Inscrivez-vous en 5 minutes</Text>
            <Text style={{ fontSize: 12, marginTop: 6 }}>Scannez le QR code : séance d'essai gratuite, dossier et paiement en ligne.</Text>
            <Text style={{ fontSize: 11, marginTop: 8 }}>{data.siteUrl.replace(/^https?:\/\//, '')}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
