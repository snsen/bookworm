#!/usr/bin/env node
// Builds public-domain test books into ./fixtures (not committed):
//   - alice.epub          Standard Ebooks source of "Alice's Adventures in Wonderland"
//   - pride.epub          Standard Ebooks source of "Pride and Prejudice"
//   - pride-a5.pdf        "Pride and Prejudice" printed to a 300+ page A5 PDF with Chromium
//   - drm-adobe.epub      A small EPUB carrying an Adobe ADEPT rights.xml (for the DRM error path)
//   - fake-kindle.azw3    A file with a MOBI header (for the Kindle error path)
//   - photo.pdf           Text pages with a colour photo, then a full-page image (like a scan)
//
// Standard Ebooks (https://standardebooks.org) produces carefully edited editions of
// Project Gutenberg transcriptions and dedicates its work to the public domain (CC0).
// Their sources are fetched from GitHub because gutenberg.org may be unreachable from
// sandboxed build environments.

import { createRequire } from 'node:module';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'fixtures');
const RAW = 'https://raw.githubusercontent.com/standardebooks';

const BOOKS = [
  { file: 'alice.epub', repo: 'lewis-carroll_alices-adventures-in-wonderland' },
  { file: 'pride.epub', repo: 'jane-austen_pride-and-prejudice' },
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function get(url, { binary = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return binary ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

/** Downloads a Standard Ebooks source tree and returns { files: Map<path, data>, opf, spine } */
async function fetchSource(repo) {
  const base = `${RAW}/${repo}/master/src`;
  const opf = await get(`${base}/epub/content.opf`);
  if (!opf) throw new Error(`No content.opf for ${repo}`);
  const files = new Map();
  files.set('META-INF/container.xml', await get(`${base}/META-INF/container.xml`));
  files.set('epub/content.opf', opf);

  const items = [...opf.matchAll(/<item\s+([^>]*?)\/?>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    return attrs;
  });
  const queue = [...items];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const path = posix.join('epub', item.href);
      const binary = !/^(text\/|application\/(xhtml\+xml|x-dtbncx\+xml))|svg/.test(item['media-type']);
      const data = await get(`${base}/${path}`, { binary });
      if (data == null) {
        console.warn(`  (missing in source, skipped) ${path}`);
        continue;
      }
      files.set(path, data);
    }
  });
  await Promise.all(workers);

  const manifest = new Map(items.map((i) => [i.id, i]));
  const spine = [...opf.matchAll(/<itemref\s+[^>]*idref="([^"]+)"/g)]
    .map((m) => manifest.get(m[1]))
    .filter(Boolean)
    .map((i) => posix.join('epub', i.href));
  return { files, spine };
}

async function zipEpub(files, extra = {}) {
  const zip = new JSZip();
  // The mimetype entry must be first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  for (const [path, data] of files) zip.file(path, data);
  for (const [path, data] of Object.entries(extra)) zip.file(path, data);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
}

async function buildPdf(source, outPath) {
  const { chromium } = require('playwright');
  const parser = (html) =>
    html
      .replace(/^[\s\S]*?<body[^>]*>/i, '')
      .replace(/<\/body>[\s\S]*$/i, '')
      .replace(/<img[^>]*>/gi, '');
  const chapters = source.spine
    .filter((p) => /chapter-\d+/.test(p))
    .map((p) => `<div class="chapter">${parser(source.files.get(p))}</div>`)
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A5; margin: 18mm 16mm 20mm; }
    body { font-family: Georgia, 'DejaVu Serif', serif; font-size: 12.5pt; line-height: 1.5; color: #111; }
    h1, h2 { text-align: center; font-weight: normal; margin: 2em 0 1em; }
    .chapter { break-before: page; }
    p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; }
    .cover { break-after: page; height: 160mm; display: flex; flex-direction: column; justify-content: center; text-align: center; }
    .cover h1 { font-size: 30pt; } .cover p { text-indent: 0; text-align: center; }
  </style></head><body>
    <section class="cover"><h1>Pride and Prejudice</h1><p>Jane Austen</p>
    <p style="margin-top:3em;font-size:10pt">Public domain text from Standard Ebooks — test fixture</p></section>
    ${chapters}
  </body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: outPath, format: 'A5', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

/** A small PDF mixing text with a colour "photo", plus one page that is a single full-page image. */
async function buildPhotoPdf(outPath) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Paint the "photo" with a canvas so the PDF embeds it as a raster image.
    const photo = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 400;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 400);
      sky.addColorStop(0, '#3b7dd8');
      sky.addColorStop(1, '#f0b35a');
      g.fillStyle = sky;
      g.fillRect(0, 0, 600, 400);
      g.fillStyle = '#e8562a';
      g.beginPath();
      g.arc(420, 150, 70, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2f6b2f';
      g.fillRect(0, 300, 600, 100);
      return c.toDataURL('image/png');
    });
    const text = 'Once upon a time, in a quiet house at the edge of the forest, a lamp was left burning. '.repeat(6);
    const html = `<!doctype html><html><head><style>
      @page { size: A5; margin: 16mm; } body { font: 12pt Georgia, serif; }
      img.photo { width: 100%; display: block; margin: 1em 0; } .page { break-after: page; }
      img.scan { width: 100%; height: 175mm; display: block; }
    </style></head><body>
      <div class="page"><h1>Photo test</h1><p>${text}</p><img class="photo" src="${photo}"><p>${text}</p></div>
      <div class="page"><p>${text}</p><img class="photo" src="${photo}"></div>
      <div><img class="scan" src="${photo}"></div>
    </body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: outPath, format: 'A5', preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const force = process.argv.includes('--force');
  let prideSource = null;
  const pdfOut = join(outDir, 'pride-a5.pdf');
  const needPdf = force || !(await exists(pdfOut));

  for (const book of BOOKS) {
    const out = join(outDir, book.file);
    const needEpub = force || !(await exists(out));
    const isPride = book.file === 'pride.epub';
    if (!needEpub && !(isPride && needPdf)) {
      console.log(`✓ ${book.file} (exists)`);
      continue;
    }
    console.log(`↓ ${book.repo}`);
    const source = await fetchSource(book.repo);
    if (isPride) prideSource = source;
    if (needEpub) {
      await writeFile(out, await zipEpub(source.files));
      console.log(`✓ ${book.file}`);
    }
  }

  if (needPdf) {
    console.log('… printing PDF with Chromium');
    await buildPdf(prideSource, pdfOut);
    console.log('✓ pride-a5.pdf');
  } else {
    console.log('✓ pride-a5.pdf (exists)');
  }

  const photoOut = join(outDir, 'photo.pdf');
  if (force || !(await exists(photoOut))) {
    await buildPhotoPdf(photoOut);
    console.log('✓ photo.pdf');
  }

  // DRM-protected EPUB stand-in: valid package + Adobe ADEPT rights file + encrypted content entry.
  const drm = new Map([
    ['META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
    ['META-INF/rights.xml', `<?xml version="1.0"?><adept:rights xmlns:adept="http://ns.adobe.com/adept"><adept:licenseToken/></adept:rights>`],
    ['META-INF/encryption.xml', `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/chapter.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`],
    ['OEBPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">drm-test</dc:identifier><dc:title>DRM test</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`],
    ['OEBPS/chapter.xhtml', new Uint8Array([0x8f, 0x13, 0x77, 0x02, 0xaa, 0x51, 0x09, 0xee])],
  ]);
  await writeFile(join(outDir, 'drm-adobe.epub'), await zipEpub(drm));
  console.log('✓ drm-adobe.epub');

  const mobi = new Uint8Array(1024);
  mobi.set(new TextEncoder().encode('Test Book'), 0);
  mobi.set(new TextEncoder().encode('BOOKMOBI'), 60);
  await writeFile(join(outDir, 'fake-kindle.azw3'), mobi);
  console.log('✓ fake-kindle.azw3');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
