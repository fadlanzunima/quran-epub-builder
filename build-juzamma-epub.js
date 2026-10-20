#!/usr/bin/env node
/* =============================================================================
 *  build-juzamma-epub.js — assemble the hand-built Juz 'Amma surah files
 *  (build/surah-0XX.xhtml, 78–114) into one complete, validated EPUB 3.
 *
 *  Reuses the proven OCF/OPF/nav structure of builder.js but with OUR pages:
 *  IndoPak Arabic + LPMQ transliteration + Kemenag translation & footnotes.
 *
 *  Output: dist/Juz Amma & Terjemahan.epub   (auto-validated via validate.js)
 *  Usage : node build-juzamma-epub.js
 * ===========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { validateEpubBuffer } = require('./validate');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache');
const FONTS_DIR = path.join(ROOT, 'fonts');
const ASSETS_DIR = path.join(ROOT, 'assets');
const BUILD_DIR = path.join(ROOT, 'build');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

const START = 78, END = 114;
const BOOK_TITLE = "Juz 'Amma & Terjemahan";
const BOOK_SUBTITLE = 'Juz 30 · Teks IndoPak, Transliterasi Latin & Terjemahan Kemenag';
const MODIFIED = '2026-10-19T00:00:00Z';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const toAr = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const pad3 = n => String(n).padStart(3, '0');
const ensureDir = d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };

/* --- font: prefer a real IndoPak font, else Scheherazade New (OFL, present) --- */
function resolveFont() {
  const candidates = [
    'IndoPak.ttf', 'IndoPak.otf', 'me_quran.ttf', 'me_quran.otf',
    'AlQalam.ttf', 'AlQalamQuran.ttf', 'PDMS_Saleem_QuranFont.ttf',
    'ScheherazadeNew-Regular.ttf', 'ScheherazadeNew.ttf'
  ];
  for (const name of candidates) {
    for (const dir of [FONTS_DIR, path.join(ASSETS_DIR, 'fonts')]) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return { file: name, path: p };
    }
  }
  return null;
}
const fontMediaType = f => { const e = path.extname(f).toLowerCase(); return e === '.otf' ? 'application/vnd.ms-opentype' : e === '.woff' ? 'application/font-woff' : e === '.woff2' ? 'font/woff2' : 'application/font-sfnt'; };
const fontCssFormat = f => { const e = path.extname(f).toLowerCase(); return e === '.otf' ? 'opentype' : e === '.woff' ? 'woff' : e === '.woff2' ? 'woff2' : 'truetype'; };

function buildCss(font) {
  const tpl = path.join(TEMPLATES_DIR, 'style.css');
  let css = fs.readFileSync(tpl, 'utf8');
  const face = font
    ? `@font-face{font-family:'QuranArabic';font-style:normal;font-weight:400;font-display:swap;src:url('../fonts/${font.file}') format('${fontCssFormat(font.file)}');}`
    : `/* no embedded font found — using system Arabic fallback */`;
  return css.replace('/*__FONT_FACE__*/', face);
}

/* --- chapter metadata (names, place, counts) --- */
const chapters = (() => {
  const c = require(path.join(CACHE, 'chapters_id.json'));
  const list = c.chapters || c;
  const m = new Map();
  for (const x of list) m.set(x.id, x);
  return m;
})();

function uuidFor(seed) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const rng = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return (h >>> 8) & 0xff; };
  const b = Array.from({ length: 16 }, rng);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/* --- cover + title pages --- */
function coverXhtml(hasImg) {
  const body = hasImg
    ? `<section epub:type="cover" class="cover-wrap"><img src="images/cover.jpg" alt="${esc(BOOK_TITLE)}"/></section>`
    : `<section epub:type="cover" class="cover-wrap"><h1 class="judul-surah">${esc(BOOK_TITLE)}</h1><p class="nama-latin">${esc(BOOK_SUBTITLE)}</p></section>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="id" lang="id">
<head><meta charset="utf-8"/><title>${esc(BOOK_TITLE)}</title><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="stylesheet" type="text/css" href="css/style.css"/></head>
<body>${body}</body></html>`;
}

function titleXhtml() {
  const body = `<section epub:type="titlepage" class="header-surah">
    <h1 class="judul-surah" lang="ar" xml:lang="ar" dir="rtl">جُزْءُ عَمَّ</h1>
    <p class="nama-latin">${esc(BOOK_TITLE)}</p>
    <h2 class="info-surah">${esc(BOOK_SUBTITLE)}</h2>
    <p class="isi-footnote">Teks Al-Qur'an: domain publik · Terjemahan &amp; catatan kaki: Kementerian Agama RI · Sumber data: quran.com &amp; quranenc.com</p>
  </section>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="id" lang="id">
<head><meta charset="utf-8"/><title>${esc(BOOK_TITLE)}</title><meta name="viewport" content="width=device-width, initial-scale=1.0"/><link rel="stylesheet" type="text/css" href="css/style.css"/></head>
<body>${body}</body></html>`;
}

/* --- nav.xhtml (toc + landmarks) --- */
function navXhtml(items) {
  const lis = items.map(it =>
    `          <li><a href="text/${it.file}">${it.id}. ${esc(it.name)} — ${esc(it.ar)}</a></li>`
  ).join('\n');
  const body = `  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1 class="judul-footnote">Daftar Isi / فهرس</h1>
    <ol>
      <li class="toc-juz"><a href="text/${items[0].file}">Juz 'Amma (Juz 30)</a>
        <ol>
${lis}
        </ol>
      </li>
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="cover" href="cover.xhtml">Sampul</a></li>
      <li><a epub:type="toc" href="nav.xhtml#toc">Daftar Isi</a></li>
      <li><a epub:type="bodymatter" href="text/${items[0].file}">Mulai Membaca</a></li>
    </ol>
  </nav>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="id" lang="id">
<head><meta charset="utf-8"/><title>Daftar Isi</title><link rel="stylesheet" type="text/css" href="css/style.css"/></head>
<body class="nav">${body}</body></html>`;
}

function ncxXml(items, uid) {
  let po = 1;
  const pts = items.map(it => `    <navPoint id="np-${it.id}" playOrder="${++po}">
      <navLabel><text>${it.id}. ${esc(it.name)}</text></navLabel>
      <content src="text/${it.file}"/>
    </navPoint>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="id">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(BOOK_TITLE)}</text></docTitle>
  <navMap>
    <navPoint id="np-juz" playOrder="1">
      <navLabel><text>Juz 'Amma (Juz 30)</text></navLabel>
      <content src="text/${items[0].file}"/>
    </navPoint>
${pts}
  </navMap>
</ncx>`;
}

function contentOpf(items, font, hasCover, hasDivider, uid) {
  const man = [];
  man.push(`    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  man.push(`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  man.push(`    <item id="css" href="css/style.css" media-type="text/css"/>`);
  if (hasCover) man.push(`    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
  if (hasDivider) man.push(`    <item id="img-divider" href="images/divider.png" media-type="image/png"/>`);
  if (font) man.push(`    <item id="font-ar" href="fonts/${font.file}" media-type="${fontMediaType(font.file)}"/>`);
  man.push(`    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
  man.push(`    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`);
  for (const it of items) man.push(`    <item id="s${it.id}" href="text/${it.file}" media-type="application/xhtml+xml"/>`);

  const spine = [`    <itemref idref="cover" linear="yes"/>`, `    <itemref idref="title" linear="yes"/>`, `    <itemref idref="nav" linear="yes"/>`];
  for (const it of items) spine.push(`    <itemref idref="s${it.id}" linear="yes"/>`);

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uid}</dc:identifier>
    <dc:title>${esc(BOOK_TITLE)}</dc:title>
    <dc:title id="subtitle">${esc(BOOK_SUBTITLE)}</dc:title>
    <dc:language>id</dc:language>
    <dc:language>ar</dc:language>
    <dc:creator>Al-Qur'an al-Karim</dc:creator>
    <dc:contributor>Kementerian Agama RI</dc:contributor>
    <dc:publisher>quran-epub-builder</dc:publisher>
    <dc:source>quran.com API v4 &amp; quranenc.com</dc:source>
    <dc:rights>Teks Al-Qur'an: domain publik. Terjemahan © Kementerian Agama RI.</dc:rights>
    <meta property="dcterms:modified">${MODIFIED}</meta>
    <meta name="cover" content="cover-image"/>
    <meta property="rendition:layout">reflowable</meta>
    <meta property="ibooks:specified-fonts">true</meta>
  </metadata>
  <manifest>
${man.join('\n')}
  </manifest>
  <spine toc="ncx" page-progression-direction="ltr">
${spine.join('\n')}
  </spine>
  <guide>
    <reference type="cover" title="Sampul" href="cover.xhtml"/>
    <reference type="toc" title="Daftar Isi" href="nav.xhtml"/>
    <reference type="text" title="Mulai" href="text/${items[0].file}"/>
  </guide>
</package>`;
}

(async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml',
`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package"/>
  </rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');
  const font = resolveFont();
  console.log(font ? `font: ${font.file}` : 'font: none (system fallback)');
  oebps.file('css/style.css', buildCss(font));
  if (font) oebps.file(`fonts/${font.file}`, fs.readFileSync(font.path));

  const coverPath = path.join(ASSETS_DIR, 'cover.jpg');
  const hasCover = fs.existsSync(coverPath);
  if (hasCover) oebps.file('images/cover.jpg', fs.readFileSync(coverPath));
  const dividerPath = path.join(ASSETS_DIR, 'divider.png');
  const hasDivider = fs.existsSync(dividerPath);
  if (hasDivider) oebps.file('images/divider.png', fs.readFileSync(dividerPath));

  oebps.file('cover.xhtml', coverXhtml(hasCover));
  oebps.file('title.xhtml', titleXhtml());

  // Add every hand-built surah file; rewrite its stylesheet href to css/style.css.
  const items = [];
  for (let id = START; id <= END; id++) {
    const file = `surah-${pad3(id)}.xhtml`;
    const src = path.join(BUILD_DIR, file);
    if (!fs.existsSync(src)) throw new Error(`missing ${src} — run: node build-juzamma.js first`);
    let xml = fs.readFileSync(src, 'utf8').replace('href="../styles/style.css"', 'href="../css/style.css"');
    oebps.file(`text/${file}`, xml);
    const meta = chapters.get(id);
    items.push({ id, file, name: meta.name_simple, ar: meta.name_arabic });
  }

  const uid = uuidFor('juzamma-id-v1');
  oebps.file('nav.xhtml', navXhtml(items));
  oebps.file('toc.ncx', ncxXml(items, `urn:uuid:${uid}`));
  oebps.file('content.opf', contentOpf(items, font, hasCover, hasDivider, uid));

  ensureDir(DIST);
  const out = path.join(DIST, `${BOOK_TITLE}.epub`);
  const buf = await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  fs.writeFileSync(out, buf);
  console.log(`wrote ${path.relative(ROOT, out)} (${(buf.length / 1024 / 1024).toFixed(2)} MB, ${items.length} surah)`);

  process.stdout.write('validating … ');
  const { errors, warnings } = await validateEpubBuffer(buf);
  if (errors.length === 0) console.log(`PASSED ✅ (0 errors${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
  else { console.log(`FAILED ❌ (${errors.length})`); errors.slice(0, 30).forEach(e => console.log('   - ' + e)); process.exitCode = 1; }
  if (warnings.length) warnings.slice(0, 10).forEach(w => console.log('   ⚠ ' + w));
})().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(1); });
