import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import { readableTextColor, safeHex } from '@/lib/utils/color-contrast';

/** react-pdf ne lit que PNG et JPEG : on ignore les autres formats plutôt que d'échouer. */
export function pdfImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('data:image/png') || url.startsWith('data:image/jpeg')) return url;
  return /\.(png|jpe?g)(\?|$)/i.test(url) ? url : null;
}

export const euros = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n).replace(/ /g, ' ');

export const frDate = (d: Date | string) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(typeof d === 'string' ? new Date(d) : d);

export const baseStyles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#18181B', lineHeight: 1.4 },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  muted: { color: '#71717A' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#E4E4E7', paddingVertical: 5 },
  th: { fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 8, color: '#A1A1AA', textAlign: 'center' },
});

export function BrandHeader({
  name,
  color,
  logoUrl,
  lines,
}: {
  name: string;
  color: string;
  logoUrl?: string | null;
  lines: (string | null | undefined)[];
}) {
  const bg = safeHex(color);
  const logo = pdfImageSrc(logoUrl);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: bg, padding: 14, borderRadius: 4, marginBottom: 18 }}>
      {logo ? <Image src={logo} style={{ width: 46, height: 46, marginRight: 12, objectFit: 'contain' }} /> : null}
      <View>
        <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: readableTextColor(bg), marginBottom: 4, lineHeight: 1.2 }}>{name}</Text>
        {lines.filter(Boolean).map((l) => (
          <Text key={l} style={{ fontSize: 8.5, color: readableTextColor(bg) }}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function TableRow({ cells, widths, header = false }: { cells: string[]; widths: string[]; header?: boolean }) {
  return (
    <View style={baseStyles.row}>
      {cells.map((c, i) => (
        <Text key={i} style={[{ width: widths[i], textAlign: i === cells.length - 1 && i > 0 ? 'right' : 'left' }, header ? baseStyles.th : {}]}>
          {c}
        </Text>
      ))}
    </View>
  );
}
