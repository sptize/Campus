// Lector mínimo de .xlsx (ZIP + XML) sin dependencias. Solo lee: hojas, celdas de texto/número y celdas combinadas.
export class XlsxError extends Error {}

export interface Merge { r1: number; c1: number; r2: number; c2: number }
export interface Sheet { name: string; cells: Map<string, string>; merges: Merge[]; maxRow: number; maxCol: number }
export interface Workbook { sheets: Sheet[] }

const MAX_FILE = 15 * 1024 * 1024;
const MAX_ENTRY = 60 * 1024 * 1024;
const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: Uint8Array): Promise<Map<string, () => Promise<Uint8Array>>> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new XlsxError('El archivo no es un libro de Excel válido (.xlsx).');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const out = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || u32(v, p) !== 0x02014b50) throw new XlsxError('El archivo está dañado (directorio ZIP incorrecto).');
    const method = u16(v, p + 10), csize = u32(v, p + 20), usize = u32(v, p + 24);
    const nlen = u16(v, p + 28), elen = u16(v, p + 30), clen = u16(v, p + 32), off = u32(v, p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (usize > MAX_ENTRY) throw new XlsxError('El archivo contiene datos demasiado grandes.');
    out.set(name, async () => {
      if (off + 30 > buf.length || u32(v, off) !== 0x04034b50) throw new XlsxError('El archivo está dañado (entrada ZIP incorrecta).');
      const start = off + 30 + u16(v, off + 26) + u16(v, off + 28);
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new XlsxError('Método de compresión no soportado.');
    });
  }
  return out;
}

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()];
  });
const textOf = (xml: string) => {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let s = ''; const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let m;
  while ((m = re.exec(clean))) s += m[1];
  return decodeEntities(s);
};
const attr = (s: string, name: string) => s.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
export const colIndex = (letters: string) => letters.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const cellKey = (r: number, c: number) => `${r},${c}`;

export async function readWorkbook(input: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length > MAX_FILE) throw new XlsxError('El archivo es demasiado grande (máximo 15 MB).');
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new XlsxError('Los archivos .xls antiguos no son compatibles. Ábrelo en Excel y guárdalo como .xlsx.');
    throw new XlsxError('El archivo no es un libro de Excel válido (.xlsx).');
  }
  const files = await unzip(buf);
  const read = async (n: string) => { const f = files.get(n); return f ? new TextDecoder().decode(await f()) : null; };
  const wbXml = await read('xl/workbook.xml');
  if (!wbXml) throw new XlsxError('No se encontró el libro de trabajo dentro del archivo.');
  const rels = (await read('xl/_rels/workbook.xml.rels')) ?? '';
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target');
    if (id && target) relMap.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  }
  const sst: string[] = [];
  const sstXml = await read('xl/sharedStrings.xml');
  if (sstXml) for (const m of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) sst.push(textOf(m[1]));

  const sheets: Sheet[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeEntities(attr(m[0], 'name') ?? 'Hoja');
    const rid = attr(m[0], 'r:id');
    const path = rid ? relMap.get(rid) : undefined;
    const xml = path ? await read(path) : null;
    if (!xml) continue;
    const cells = new Map<string, string>(); let maxRow = 0, maxCol = 0;
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r')?.match(/^([A-Z]+)(\d+)$/);
      if (!ref || !c[2]) continue;
      const t = attr(c[1], 't'); const body = c[2];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (t === 's') val = v !== undefined ? sst[+v] ?? '' : '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (v !== undefined) val = decodeEntities(v);
      val = val.replace(/\s+/g, ' ').trim();
      if (!val) continue;
      const r = +ref[2] - 1, col = colIndex(ref[1]);
      cells.set(cellKey(r, col), val); maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, col);
    }
    const merges: Merge[] = [];
    for (const mm of xml.matchAll(/<mergeCell\b[^>]*>/g)) {
      const ref = attr(mm[0], 'ref')?.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      if (ref) merges.push({ r1: +ref[2] - 1, c1: colIndex(ref[1]), r2: +ref[4] - 1, c2: colIndex(ref[3]) });
    }
    sheets.push({ name, cells, merges, maxRow, maxCol });
  }
  if (!sheets.length) throw new XlsxError('El libro no contiene hojas legibles.');
  return { sheets };
}
