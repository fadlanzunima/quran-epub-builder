'use strict';

/* =============================================================================
 * build-x4-kemenag-epub.js — styled Al-Qur'an EPUB for Xteink X4 (the source
 * you convert to the device's .xtc via Xteink's official app).
 * -----------------------------------------------------------------------------
 * NOTE: the .xtc (XTeink Container) format is proprietary and cannot be authored
 * here. Build this EPUB, then convert it to .xtc with the Xteink app — the
 * converter bakes in the font/layout, so the Kemenag face and bold text carry
 * over to the X4 (native EPUB on the X4 otherwise needs a .bin device font).
 *
 * Derived from the Uthmani source (dist/Al-Quran/epub/Universal/Al-Quran.epub):
 *   • Font  -> LPMQ Isep Misbah (Kemenag Mushaf Standar Indonesia), embedded.
 *   • Text  -> bold (Arabic flow, surah title, bismillah).
 *   • Ayah number -> the font's own rose/ornament motif, BOLD, no CSS pill
 *     (no border / background / rounded box).
 *   • Cover -> assets/alquran_karim_text_cover.jpg.
 *   • TOC   -> flat per-surah list (114 entries) in nav.xhtml + toc.ncx, so the
 *     table-of-contents jumps straight to each surah.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT = __dirname;
const SRC_EPUB = path.join(ROOT, 'dist', 'Al-Quran', 'epub', 'Universal', 'Al-Quran.epub');
const OUT_EPUB = path.join(ROOT, 'dist', 'Al-Quran', 'epub', 'Xteink-X4', 'Al-Quran Xteink X4 (Kemenag).epub');
const COVER_SRC = path.join(ROOT, 'assets', 'alquran_karim_text_cover.jpg');
const FONT = { file: 'LPMQ-IsepMisbah.ttf', src: path.join(ROOT, 'assets', 'fonts', 'LPMQ-IsepMisbah.ttf'), mime: 'application/font-sfnt' };

const OLD_FONT_RE = /OEBPS\/fonts\/[^/]+\.(otf|ttf)$/i;

function extractSurahList(navXhtml) {
  // One entry per surah (its own first-ayah anchor), ordered 1..114.
  const found = new Map();
  const re = /<a href="(text\/surah-(\d{3})\.xhtml#ayah-(\d+)-1)">([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(navXhtml))) {
    const fileNum = parseInt(m[2], 10);
    const ayahSurah = parseInt(m[3], 10);
    if (fileNum !== ayahSurah) continue;      // skip mid-surah juz anchors
    if (!found.has(fileNum)) found.set(fileNum, { href: m[1], label: m[4].trim() });
  }
  const list = [];
  for (let n = 1; n <= 114; n++) {
    if (!found.has(n)) throw new Error(`Surah ${n} missing from source TOC.`);
    list.push(found.get(n));
  }
  return list;
}

function buildNav(surahs) {
  const items = surahs.map(s => `      <li><a href="${s.href}">${s.label}</a></li>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ar" lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <title>Daftar Isi</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" type="text/css" href="css/style.css"/>
</head>
<body class="nav" dir="rtl">
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>Daftar Isi — فهرس السور</h1>
    <ol>
${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="cover" href="cover.xhtml">Sampul</a></li>
      <li><a epub:type="toc" href="nav.xhtml">Daftar Isi</a></li>
      <li><a epub:type="bodymatter" href="text/surah-001.xhtml">Mulai Membaca</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function buildNcx(surahs, uid) {
  const points = surahs.map((s, i) =>
    `    <navPoint id="np-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${s.label}</text></navLabel>
      <content src="${s.href}"/>
    </navPoint>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="ar">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>القرآن الكريم</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

const X4_CSS_OVERRIDES = `
/* ===== Xteink X4 (Kemenag) overrides (appended) ====================
   Force high-contrast black-on-white (override the soft-color media query so
   e-ink stays crisp), LPMQ font, BOLD text, ayah rose motif (no CSS pill). */
:root{--ink:#000 !important;--paper:#ffffff !important;--muted:#2b2b2b !important;--rule:#000 !important;}
.quran-flow,.surah-name-ar,.bismillah,.teks-arab,.judul-surah{font-weight:bold;color:#000;}
.ayah-num,.nomor-ayat{
  border:0;background:none;border-radius:0;min-width:0;padding:0;margin:0 .2em;
  font-size:.9em;line-height:1.2;vertical-align:middle;white-space:nowrap;
  font-weight:bold;color:#000;
}
`;

async function main() {
  if (!fs.existsSync(SRC_EPUB)) throw new Error(`Source EPUB not found: ${SRC_EPUB}`);
  if (!fs.existsSync(COVER_SRC)) throw new Error(`Cover not found: ${COVER_SRC}`);
  if (!fs.existsSync(FONT.src)) throw new Error(`Font not found: ${FONT.src}`);

  const src = await JSZip.loadAsync(fs.readFileSync(SRC_EPUB));

  const cssEntry = Object.keys(src.files).find(n => /css\/style\.css$/.test(n));
  const opfEntry = Object.keys(src.files).find(n => /content\.opf$/.test(n));
  const navEntry = Object.keys(src.files).find(n => /nav\.xhtml$/.test(n));
  const ncxEntry = Object.keys(src.files).find(n => /toc\.ncx$/.test(n));
  if (!cssEntry || !opfEntry || !navEntry || !ncxEntry) throw new Error('Source EPUB missing css/opf/nav/ncx.');

  const navXhtml = await src.file(navEntry).async('string');
  const surahs = extractSurahList(navXhtml);

  const opf = await src.file(opfEntry).async('string');
  const uid = (opf.match(/<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/) || [, 'urn:uuid:quran-x4'])[1];

  // CSS: repoint the Quran font to LPMQ, then append bold + ayah-motif overrides.
  let css = await src.file(cssEntry).async('string');
  css = css.replace(/@font-face\{[^}]*\}/,
    `@font-face{font-family:'QuranArabic';font-style:normal;font-weight:400;font-display:swap;src:url('../fonts/${FONT.file}') format('truetype');}`);
  css += X4_CSS_OVERRIDES;

  // OPF: swap the font manifest item to LPMQ.
  const newOpf = opf.replace(/<item id="font-ar"[^>]*\/>/,
    `<item id="font-ar" href="fonts/${FONT.file}" media-type="${FONT.mime}"/>`);

  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  for (const name of Object.keys(src.files)) {
    if (name === 'mimetype') continue;
    const entry = src.files[name];
    if (entry.dir) continue;
    if (OLD_FONT_RE.test(name)) continue;                 // drop old embedded font
    if (name === cssEntry) { out.file(name, css); continue; }
    if (name === opfEntry) { out.file(name, newOpf); continue; }
    if (name === navEntry) { out.file(name, buildNav(surahs)); continue; }
    if (name === ncxEntry) { out.file(name, buildNcx(surahs, uid)); continue; }
    if (/\/images\/cover\.jpg$/.test(name)) { out.file(name, fs.readFileSync(COVER_SRC)); continue; }
    out.file(name, await entry.async('nodebuffer'));
  }
  // Add the Kemenag font.
  out.file(`${opfEntry.replace(/content\.opf$/, '')}fonts/${FONT.file}`, fs.readFileSync(FONT.src));

  const buf = await out.generateAsync({
    type: 'nodebuffer', mimeType: 'application/epub+zip',
    compression: 'DEFLATE', compressionOptions: { level: 9 },
  });
  fs.mkdirSync(path.dirname(OUT_EPUB), { recursive: true });
  fs.writeFileSync(OUT_EPUB, buf);

  const mb = (buf.length / (1024 * 1024)).toFixed(2);
  console.log(`Created ${path.relative(ROOT, OUT_EPUB)} (${mb} MB)`);
  console.log(`Font: LPMQ Isep Misbah (Kemenag) · text + ayah numbers BOLD · ayah = rose motif (no pill)`);
  console.log(`Cover: ${path.basename(COVER_SRC)} · TOC: flat ${surahs.length}-surah (nav.xhtml + toc.ncx)`);
  console.log(`Next: convert this EPUB to .xtc with the Xteink app for the X4.`);
}

main().catch(err => { console.error(`Failed to build Xteink X4 (Kemenag) EPUB: ${err.message}`); process.exitCode = 1; });
