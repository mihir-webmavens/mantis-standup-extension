// MantisAI's PDF preview (native-host/mantis-ai-host.mjs): page images, text and
// annotations for the read_pdf tool, on PDFs built by tests/helpers/pdf.mjs.
// Rendering needs poppler-utils (pdfinfo, pdftoppm, pdftotext); the encrypted PDF
// is made with Ghostscript. Tests needing a missing tool are skipped and say so.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pdfPreview, pdfAnnotations, pdfOptions, pdfDate, pdfToolResult, PDF_MAX_BYTES } from '../../native-host/mantis-ai-host.mjs';
import { makePdf } from '../helpers/pdf.mjs';

const hasPoppler = spawnSync('pdftoppm', ['-v']).status === 0;
const hasGs = spawnSync('gs', ['--version']).status === 0;
const needsPoppler = { skip: !hasPoppler && 'poppler-utils not installed' };

const cacheDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-pdf-test-'));
const jpegSize = (buf) => {
  // Width and height from the first SOF marker.
  for (let i = 2; i < buf.length;) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
};

describe('PDF preview', () => {
  test('a text PDF: text, page images at 150 DPI as JPEG', needsPoppler, async () => {
    const pdf = makePdf({ pages: [{ text: 'Make the login button bigger' }] });
    const r = await pdfPreview(pdf, { cacheDir: cacheDir() });
    assert.equal(r.page_count, 1);
    assert.deepEqual(r.pages_returned, [1, 1]);
    assert.equal(r.has_more_pages, false);
    assert.equal(r.next_page_from, undefined);
    assert.equal(r.text_content, '--- Page 1 ---\nMake the login button bigger');
    assert.equal(r.text_truncated, false);
    assert.equal(r.preview_error, undefined);
    assert.equal(r.pages.length, 1);
    const { width, height } = jpegSize(r.pages[0].jpeg); // US Letter at 150 DPI
    assert.equal(width, 1275);
    assert.ok(Math.abs(height - 1650) <= 1);
  });

  test('a scanned (image-only) PDF: no text, but the pages render', needsPoppler, async () => {
    const r = await pdfPreview(makePdf({ pages: [{ shape: true }, { shape: true }] }), { cacheDir: cacheDir() });
    assert.equal(r.text_content, '');
    assert.match(r.text_note, /scanned or image-only/);
    assert.deepEqual(r.pages.map((p) => p.page), [1, 2]);
    assert.ok(r.pages.every((p) => p.jpeg[0] === 0xff && p.jpeg[1] === 0xd8));
  });

  test('wide pages are scaled to at most 1600px', needsPoppler, async () => {
    const r = await pdfPreview(makePdf({ pages: [{ text: 'a' }, { shape: true, width: 1191, height: 842 }] }), { cacheDir: cacheDir() });
    assert.equal(jpegSize(r.pages[0].jpeg).width, 1275);
    assert.equal(jpegSize(r.pages[1].jpeg).width, 1600);
  });

  test('annotations: sticky notes, free text, highlights, with author and date; links skipped', needsPoppler, async () => {
    const pdf = makePdf({ pages: [
      { text: 'One' },
      { text: 'Two', annots: [
        { subtype: 'Text', contents: 'Make button bigger', author: 'Rutu', date: "D:20261119015836+05'30'" },
        { subtype: 'FreeText', contents: 'Logo (new) here', author: 'Rutu' },
        { subtype: 'Highlight', rc: '<body><p>Wrong <b>colour</b></p></body>' },
        { subtype: 'Link' },
      ] },
    ] });
    const r = await pdfPreview(pdf, { cacheDir: cacheDir() });
    assert.deepEqual(r.annotations, [
      { page: 2, type: 'Text', author: 'Rutu', text: 'Make button bigger', created_at: '2026-11-18T20:28:36.000Z' },
      { page: 2, type: 'FreeText', author: 'Rutu', text: 'Logo (new) here', created_at: null },
      { page: 2, type: 'Highlight', author: null, text: 'Wrong colour', created_at: null },
    ]);
  });

  test('a multi-page PDF is paged: ten pages per call, then the rest from next_page_from', needsPoppler, async () => {
    const pdf = makePdf({ pages: Array.from({ length: 12 }, (_, i) => ({ text: `Page text ${i + 1}`, annots: i === 10 ? [{ contents: 'late note' }] : [] })) });
    const dir = cacheDir();
    const first = await pdfPreview(pdf, { ...pdfOptions({ attachment_id: 1 }), cacheDir: dir });
    assert.equal(first.page_count, 12);
    assert.deepEqual(first.pages_returned, [1, 10]);
    assert.equal(first.has_more_pages, true);
    assert.equal(first.next_page_from, 11);
    assert.deepEqual(first.pages.map((p) => p.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.match(first.text_content, /Page text 10/);
    assert.doesNotMatch(first.text_content, /Page text 11/);
    assert.deepEqual(first.annotations, []);

    const rest = await pdfPreview(pdf, { ...pdfOptions({ attachment_id: 1, page_from: 11 }), cacheDir: dir });
    assert.deepEqual(rest.pages_returned, [11, 12]);
    assert.equal(rest.has_more_pages, false);
    assert.deepEqual(rest.pages.map((p) => p.page), [11, 12]);
    assert.deepEqual(rest.annotations.map((a) => a.text), ['late note']);

    const one = await pdfPreview(pdf, { ...pdfOptions({ attachment_id: 1, page_from: 3, page_to: 3, include_text: false }), cacheDir: dir });
    assert.deepEqual(one.pages_returned, [3, 3]);
    assert.equal(one.text_content, undefined);
    assert.equal(one.next_page_from, 4);

    const textOnly = await pdfPreview(pdf, { ...pdfOptions({ attachment_id: 1, include_pages: false }), cacheDir: dir });
    assert.equal(textOnly.pages.length, 0);
    assert.match(textOnly.text_content, /Page text 1\b/);

    const past = await pdfPreview(pdf, { ...pdfOptions({ attachment_id: 1, page_from: 13 }), cacheDir: dir });
    assert.match(past.preview_error, /past the last page \(12\)/);
  });

  test('rendered pages and text are cached per file and reused', needsPoppler, async () => {
    const dir = cacheDir();
    const pdf = makePdf({ pages: [{ text: 'cache me' }] });
    await pdfPreview(pdf, { cacheDir: dir });
    const [folder] = fs.readdirSync(dir);
    assert.match(folder, /^[0-9a-f]{64}$/);
    assert.ok(['source.pdf', 'info.json', 'page-1.jpg', 'text-1-1.txt', 'annotations.json'].every((f) => fs.existsSync(path.join(dir, folder, f))));
    fs.writeFileSync(path.join(dir, folder, 'text-1-1.txt'), 'from the cache');
    assert.equal((await pdfPreview(pdf, { cacheDir: dir })).text_content, 'from the cache');
  });

  test('old cache folders are removed', needsPoppler, async () => {
    const dir = cacheDir();
    const old = path.join(dir, 'a'.repeat(64));
    fs.mkdirSync(old);
    const longAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, longAgo, longAgo);
    await pdfPreview(makePdf({ pages: [{ text: 'x' }] }), { cacheDir: dir });
    assert.equal(fs.existsSync(old), false);
  });

  test('text is capped at 50,000 characters', needsPoppler, async () => {
    const line = 'x'.repeat(95);
    const pdf = makePdf({ pages: Array.from({ length: 10 }, () => ({ lines: Array.from({ length: 100 }, () => line) })) });
    const r = await pdfPreview(pdf, { cacheDir: cacheDir() });
    assert.equal(r.text_content.length, 50000);
    assert.equal(r.text_truncated, true);
  });

  test('an encrypted PDF returns metadata and preview_error, never throws', { skip: (!hasPoppler || !hasGs) && 'needs poppler-utils and Ghostscript' }, async () => {
    const dir = cacheDir();
    const plain = path.join(dir, 'plain.pdf');
    const locked = path.join(dir, 'locked.pdf');
    fs.writeFileSync(plain, makePdf({ pages: [{ text: 'secret', annots: [{ contents: 'hidden' }] }] }));
    const gs = spawnSync('gs', ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', '-sOwnerPassword=owner', '-sUserPassword=user', `-sOutputFile=${locked}`, plain]);
    assert.equal(gs.status, 0, gs.stderr.toString());
    const r = await pdfPreview(fs.readFileSync(locked), { cacheDir: path.join(dir, 'cache') });
    assert.match(r.preview_error, /password-protected/);
    assert.equal(r.size, fs.statSync(locked).size);
    assert.equal(r.pages, undefined);
    assert.deepEqual(pdfAnnotations(fs.readFileSync(locked)), []);
  });

  test('a damaged PDF returns preview_error', needsPoppler, async () => {
    const r = await pdfPreview(Buffer.from('%PDF-1.4\nthis is not really a pdf\n'), { cacheDir: cacheDir() });
    assert.ok(r.preview_error);
    assert.equal(r.pages, undefined);
  });

  test('not a PDF, over 50 MB or over 200 pages: not converted', needsPoppler, async () => {
    assert.match((await pdfPreview(Buffer.from('\x89PNG\r\n'), { cacheDir: cacheDir() })).preview_error, /not a PDF/);
    assert.match((await pdfPreview(Buffer.alloc(PDF_MAX_BYTES + 1), { cacheDir: cacheDir() })).preview_error, /larger than 50 MB/);
    const many = await pdfPreview(makePdf({ pages: Array.from({ length: 201 }, () => ({ text: 'p' })) }), { cacheDir: cacheDir() });
    assert.equal(many.page_count, 201);
    assert.match(many.preview_error, /over 200 pages/);
    assert.equal(many.pages, undefined);
  });

  test('a missing poppler is explained', async () => {
    const { spawn } = await import('node:child_process');
    const script = `
      import { pdfPreview } from ${JSON.stringify(new URL('../../native-host/mantis-ai-host.mjs', import.meta.url).href)};
      import { makePdf } from ${JSON.stringify(new URL('../helpers/pdf.mjs', import.meta.url).href)};
      const r = await pdfPreview(makePdf({ pages: [{ text: 'x' }] }), { cacheDir: process.argv[1] });
      console.log(JSON.stringify(r));`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, cacheDir()], { env: { ...process.env, MANTIS_AI_PDFINFO: 'no-such-pdfinfo-tool' } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    await new Promise((r) => child.on('close', r));
    assert.match(JSON.parse(out).preview_error, /no-such-pdfinfo-tool is not installed.*poppler-utils/);
  });
});

describe('PDF annotations reader', () => {
  test('reads annotations packed in compressed object streams, and UTF-16 text', () => {
    const pdf = makePdf({ packAnnots: true, pages: [{ text: 'a' }, { text: 'b', annots: [{ subtype: 'FreeText', contents: 'बटन बड़ा करें', author: 'Rutu' }] }] });
    assert.deepEqual(pdfAnnotations(pdf), [{ page: 2, type: 'FreeText', author: 'Rutu', text: 'बटन बड़ा करें', created_at: null }]);
  });

  test('a damaged file gives no annotations instead of failing', () => {
    assert.deepEqual(pdfAnnotations(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Annot /Contents (unterminated\nendobj')), []);
  });

  test('PDF dates become ISO 8601', () => {
    assert.equal(pdfDate("D:20261119015836+05'30'"), '2026-11-18T20:28:36.000Z');
    assert.equal(pdfDate('D:20261119015836Z'), '2026-11-19T01:58:36.000Z');
    assert.equal(pdfDate('D:2026'), '2026-01-01T00:00:00.000Z');
    assert.equal(pdfDate('yesterday'), null);
    assert.equal(pdfDate(undefined), null);
  });
});

describe('read_pdf arguments and result', () => {
  test('defaults and the ten-page cap', () => {
    assert.deepEqual(pdfOptions({ attachment_id: 6791 }), { attachmentId: 6791, pageFrom: 1, pageTo: 10, includePages: true, includeText: true });
    assert.deepEqual(pdfOptions({ attachment_id: 6791, page_from: 11, page_to: 40 }).pageTo, 20);
    assert.equal(pdfOptions({ attachment_id: '6791' }).attachmentId, 6791);
    assert.ok(pdfOptions({}).error);
    assert.ok(pdfOptions({ attachment_id: -1 }).error);
    assert.ok(pdfOptions({ attachment_id: 1, page_from: 0 }).error);
    assert.ok(pdfOptions({ attachment_id: 1, page_from: 5, page_to: 2 }).error);
    assert.ok(pdfOptions({ attachment_id: 1, include_pages: 'yes' }).error);
  });

  test('page images follow their labels in page order; metadata first', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = pdfToolResult(6791, 'phone app feedback.pdf', { page_count: 12, pages_returned: [3, 4], annotations: [], pages: [{ page: 3, jpeg }, { page: 4, jpeg }] });
    assert.deepEqual(JSON.parse(result.content[0].text), { id: 6791, filename: 'phone app feedback.pdf', mime: 'application/pdf', page_count: 12, pages_returned: [3, 4], annotations: [], image_included: true });
    assert.deepEqual(result.content.slice(1), [
      { type: 'text', text: 'Page 3 of 12' }, { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
      { type: 'text', text: 'Page 4 of 12' }, { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
    ]);
  });
});
