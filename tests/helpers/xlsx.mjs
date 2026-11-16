// Construction de classeurs .xlsx minimaux pour les tests d'import (Footclubs, HelloAsso) : aucune donnée réelle.
const enc = new TextEncoder();

async function deflateRaw(bytes) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return new Uint8Array(out);
}

// Petit écrivain ZIP (CRC non vérifié par le lecteur, mis à 0).
export async function zip(files, { compress = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = compress ? await deflateRaw(raw) : raw;
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, compress ? 8 : 0, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, compress ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (i) => String.fromCharCode(65 + i);

// Classeur : titres + lignes, chaînes partagées pour les titres, chaînes en ligne pour les valeurs.
export async function xlsx(rows, opts = {}) {
  const [header, ...data] = rows;
  // prefix : « x » imite l'export HelloAsso (balises <x:row>, <x:c>…).
  const ns = opts.prefix ? `${opts.prefix}:` : '';
  const shared = `<sst>${header.map((h) => `<si><t>${esc(h)}</t></si>`).join('')}</sst>`;
  const cell = (v, r, c) => (typeof v === 'number' ? `<c r="${colName(c)}${r}"><v>${v}</v></c>` : `<c r="${colName(c)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`);
  const sheet = `<worksheet><sheetData><row r="1">${header.map((_, c) => `<c r="${colName(c)}1" t="s"><v>${c}</v></c>`).join('')}</row>${data
    .map((row, i) => `<row r="${i + 2}">${row.map((v, c) => (v === '' ? '' : cell(v, i + 2, c))).join('')}</row>`)
    .join('')}</sheetData></worksheet>`;
  const tag = (xml) => (ns ? xml.replace(/<(\/?)(?=[a-zA-Z])/g, `<$1${ns}`) : xml);
  return zip({ '[Content_Types].xml': '<Types/>', 'xl/sharedStrings.xml': tag(shared), 'xl/worksheets/sheet1.xml': tag(sheet) }, opts);
}
