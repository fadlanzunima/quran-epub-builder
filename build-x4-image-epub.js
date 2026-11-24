'use strict';

/* =============================================================================
 * build-x4-image-epub.js — "picture" EPUB for Xteink X4 on LICORICE firmware.
 * -----------------------------------------------------------------------------
 * Licorice (XTOS) has NO Arabic shaping engine: fed Unicode Arabic it draws the
 * letters disconnected, and it refuses to open PDF. Its own docs say it falls
 * back to rendering Arabic "as pictures". So we do exactly that, up front:
 *
 *   1. take the 480x800 Xteink X4 PDF (Chrome already baked the Arabic joining
 *      + harakat into it as vector text),
 *   2. rasterise every page to a 480x800 grayscale JPEG (mupdf render + sharp),
 *   3. wrap one image per page in a plain reflowable EPUB — each XHTML is a
 *      single full-screen <img>, one screen per page.
 *
 * Result: an EPUB Licorice opens natively, with the Arabic already connected.
 * Trade-off: it is images, so no reflow and no font-size change on the device.
 *
 * Prereq: dist/Al-Quran Xteink X4.pdf must exist (npm run build:x4-pdf).
 * Image format: JPEG (the X4 supports JPG/BMP; PNG is not guaranteed).
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const sharp = require('sharp');
// mupdf ships as ESM with top-level await, so it can only be loaded via import().

const ROOT = __dirname;
// Source PDF and output EPUB are overridable (e.g. to render the Kemenag PDF).
const SRC_PDF = process.env.X4_SRC_PDF
  ? path.resolve(ROOT, process.env.X4_SRC_PDF)
  : path.join(ROOT, 'dist', 'Al-Quran Xteink X4.pdf');
const OUT_EPUB = process.env.X4_OUT_IMAGE_EPUB
  ? path.resolve(ROOT, process.env.X4_OUT_IMAGE_EPUB)
  : path.join(ROOT, 'dist', 'Al-Quran Xteink X4 (Gambar).epub');

const PAGE_W = 480;
const PAGE_H = 800;
const JPEG_QUALITY = 88; // grayscale line-art on e-ink; keeps text crisp + small

const pad = (n, w = 4) => String(n).padStart(w, '0');

async function main() {
  if (!fs.existsSync(SRC_PDF)) {
    throw new Error(`Source PDF not found: ${SRC_PDF}\nRun: npm run build:x4-pdf first.`);
  }

  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(fs.readFileSync(SRC_PDF), 'application/pdf');
  const pageCount = doc.countPages();
  if (pageCount < 1) throw new Error('Source PDF has no pages.');

  const zip = new JSZip();
  // mimetype MUST be first and STORED (uncompressed).
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const manifestItems = [];
  const spineItems = [];

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const box = page.getBounds();                 // points
    const scale = PAGE_W / (box[2] - box[0]);
    const matrix = mupdf.Matrix.scale(scale, scale);
    const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceGray, false, false);
    const jpg = await sharp(pix.asPNG())
      .resize(PAGE_W, PAGE_H, { fit: 'fill' })
      .grayscale()
      .jpeg({ quality: JPEG_QUALITY, progressive: false })
      .toBuffer();

    const imgName = `img/p${pad(i)}.jpg`;
    const pageName = `p${pad(i)}.xhtml`;
    zip.file(`OEBPS/${imgName}`, jpg);
    zip.file(`OEBPS/${pageName}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/>
<title>${i + 1}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="pg"><img src="${imgName}" alt="${i + 1}"/></div></body></html>`);

    const imgId = `img${pad(i)}`;
    const pageId = `pg${pad(i)}`;
    const props = i === 0 ? ' properties="cover-image"' : '';
    manifestItems.push(`<item id="${imgId}" href="${imgName}" media-type="image/jpeg"${props}/>`);
    manifestItems.push(`<item id="${pageId}" href="${pageName}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${pageId}"/>`);

    if ((i + 1) % 100 === 0 || i === pageCount - 1) {
      process.stdout.write(`\r  rasterised ${i + 1}/${pageCount} pages`);
    }
  }
  process.stdout.write('\n');

  zip.file('OEBPS/style.css',
    `html,body{margin:0;padding:0;background:#fff;}
.pg{margin:0;padding:0;text-align:center;page-break-after:always;break-after:page;}
.pg img{display:block;width:100%;height:auto;max-width:100%;}`);

  // EPUB3 nav (required). One entry — the book reads sequentially.
  zip.file('OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="UTF-8"/><title>Daftar Isi</title></head>
<body><nav epub:type="toc" id="toc"><ol><li><a href="p0000.xhtml">Al-Qur'an al-Karim</a></li></ol></nav></body></html>`);
  manifestItems.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');

  zip.file('OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">xteink-x4-quran-image-${pageCount}</dc:identifier>
    <dc:title>Al-Qur'an al-Karim (Xteink X4, Gambar)</dc:title>
    <dc:language>ar</dc:language>
    <meta name="cover" content="img0000"/>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`);

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(OUT_EPUB, buf);

  const sizeMb = (buf.length / (1024 * 1024)).toFixed(2);
  console.log(`Created ${path.relative(ROOT, OUT_EPUB)} (${pageCount} image pages, ${sizeMb} MB).`);
  console.log(`Arabic is baked into JPEG pages (already joined) — opens on Licorice; no device font needed.`);
}

main().catch(error => {
  console.error(`\nFailed to build Xteink X4 image EPUB: ${error.message}`);
  process.exitCode = 1;
});
