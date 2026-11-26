// Builds small PDFs for the PDF preview tests, so no binary fixtures are needed.
//   makePdf({ pages: [{ text?, lines?, shape?, width?, height?, annots?: [{ subtype, contents, author, date, rc }] }], packAnnots? })
// `text` draws Helvetica text (a text PDF); `shape` fills a rectangle and has no
// text layer (like a scan). `packAnnots` stores the annotations in a compressed
// object stream, as PDF 1.5+ writers do (only the annotation reader looks there).
import zlib from 'node:zlib';

const pdfString = (s) => `(${String(s).replace(/[\\()]/g, (c) => `\\${c}`)})`;
// UTF-16BE with a byte order mark, as a hex string (for non-Latin text).
const utf16 = (s) => `<FEFF${Buffer.from(s, 'utf16le').swap16().toString('hex').toUpperCase()}>`;

export function makePdf({ pages, packAnnots = false }) {
  const objects = []; // [num, body]
  let next = 1;
  const add = (body) => {
    const num = next++;
    objects.push([num, body]);
    return num;
  };
  const reserve = () => next++;

  const catalog = reserve();
  const pagesNum = reserve();
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const packed = []; // [num, body] for the object stream
  const kids = [];
  for (const page of pages) {
    const ops = [];
    if (page.shape) ops.push('0.2 0.4 0.8 rg 72 72 300 300 re f');
    if (page.text) ops.push(`BT /F1 24 Tf 72 700 Td ${pdfString(page.text)} Tj ET`);
    (page.lines || []).forEach((line, i) => ops.push(`BT /F1 6 Tf 10 ${780 - i * 7} Td ${pdfString(line)} Tj ET`));
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const annotRefs = (page.annots || []).map((a) => {
      const body = [
        '<< /Type /Annot', `/Subtype /${a.subtype || 'Text'}`, '/Rect [100 100 200 200]',
        a.contents != null ? `/Contents ${/[^\x20-\x7e]/.test(a.contents) ? utf16(a.contents) : pdfString(a.contents)}` : '',
        a.author ? `/T ${pdfString(a.author)}` : '',
        a.date ? `/CreationDate ${pdfString(a.date)}` : '',
        a.rc ? `/RC ${pdfString(a.rc)}` : '',
        '>>',
      ].filter(Boolean).join(' ');
      if (!packAnnots) return add(body);
      const num = reserve();
      packed.push([num, body]);
      return num;
    });
    const annots = annotRefs.length ? ` /Annots [${annotRefs.map((n) => `${n} 0 R`).join(' ')}]` : '';
    const size = `[0 0 ${page.width || 612} ${page.height || 792}]`;
    kids.push(add(`<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox ${size} /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${annots} >>`));
  }
  objects.push([pagesNum, `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(' ')}] /Count ${kids.length} >>`]);
  objects.push([catalog, `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`]);

  let streamObj = null;
  if (packed.length) {
    const bodies = packed.map(([, body]) => `${body}\n`);
    const offsets = [];
    let at = 0;
    for (const body of bodies) {
      offsets.push(at);
      at += body.length;
    }
    const header = packed.map(([num], i) => `${num} ${offsets[i]}`).join(' ');
    const first = header.length + 1;
    const data = zlib.deflateSync(Buffer.from(`${header}\n${bodies.join('')}`, 'latin1'));
    streamObj = [next++, data, `<< /Type /ObjStm /N ${packed.length} /First ${first} /Filter /FlateDecode /Length ${data.length} >>`];
  }

  objects.sort((a, b) => a[0] - b[0]);
  const parts = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let length = parts[0].length;
  const offsets = {};
  const push = (buf) => {
    parts.push(buf);
    length += buf.length;
  };
  for (const [num, body] of objects) {
    offsets[num] = length;
    push(Buffer.from(`${num} 0 obj\n${body}\nendobj\n`, 'latin1'));
  }
  if (streamObj) {
    const [num, data, dict] = streamObj;
    offsets[num] = length;
    push(Buffer.concat([Buffer.from(`${num} 0 obj\n${dict}\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]));
  }
  const size = next;
  const xrefAt = length;
  const rows = ['0000000000 65535 f \n'];
  for (let n = 1; n < size; n++) rows.push(offsets[n] != null ? `${String(offsets[n]).padStart(10, '0')} 00000 n \n` : '0000000000 65535 f \n');
  push(Buffer.from(`xref\n0 ${size}\n${rows.join('')}trailer\n<< /Size ${size} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
