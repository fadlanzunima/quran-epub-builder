'use strict';

// Generic EPUB -> PDF converter (Chrome headless).
// Reads the spine order from the EPUB's OPF, concatenates every spine document
// into one printable HTML (rewriting relative resource URLs so fonts/images/CSS
// still resolve), renders a full-page cover image, and prints to PDF.
//
//   node build-epub-pdf.js dzikir        only the Dzikir Pagi & Petang book
//   node build-epub-pdf.js juzamma       only the Juz 'Amma book
//   node build-epub-pdf.js all           both (default)
//   node build-epub-pdf.js all x4        X4-screen-sized, Kemenag font baked in
//   (add `x4` after the book to target the Xteink X4; default profile is universal)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const sharp = require('sharp');
// Pull the Al-Quran Arabic (Xteink X4) font + sizing so the Dzikir Arabic can
// follow the exact same treatment as Al-Quran-Arabic.xtcz and stay in sync.
const { DEVICES, QURAN_FONT } = require('./build-xteink-pdf.js');

const ROOT = __dirname;
const X4_ARABIC = DEVICES.x4.type;
const MM_PER_IN = 25.4;

// Output profiles. `universal` is a comfortable A5-ish sheet whose 3:4 ratio
// matches the covers (full-bleed, no letterbox). `x4` is sized 1:1 to the
// Xteink X4 screen (480x800 @ 220 PPI) and bakes the Arabic glyphs so the X4
// renders correct Arabic regardless of its device font (the X4 ignores EPUB
// @font-face, which is why the EPUB route garbled the Arabic).
const PROFILES = {
  universal: {
    widthMm: 140, heightMm: 187.4, marginCss: '14mm 12mm',
    coverFit: 'cover',              // page ratio == cover ratio, fills cleanly
    pdfKey: 'pdf', bakeArabic: false,
  },
  // Half-size sheet, same ratio: when the page-image wrapper rasterises it to
  // the same 1072 px panel width, everything appears ~2x bigger — for books
  // read as fixed images on the Clara (no zoom), e.g. the Dzikir.
  clara05: {
    widthMm: 70, heightMm: 93.7, marginCss: '6mm 5mm',
    coverFit: 'cover',
    pdfKey: 'pdf', bakeArabic: false,
  },
  x4: {
    // Matches the proven-working Xteink reference `Al-Quran.pdf` (Universal):
    // page 91×123mm, Arabic 15pt (=20px), Kemenag font, hierarchical bookmarks.
    // (Not the raw 480×800 screen — the official Xteink app expects this format.)
    widthMm: 91, heightMm: 123,
    marginCss: '5mm',
    coverFit: 'cover',              // page ratio ≈ cover ratio (~1.35)
    arabicPx: 20, arabicLineHeight: 2.0,
    pdfKey: 'pdfX4', bakeArabic: true,
    // Device-bound: the Xteink rules are MANDATORY here, so the build asserts
    // them (page size, bookmarks, no stray Arabic font) and fails loudly if any
    // is missing — see [[xteink-delivery-workflow]].
    requireOutline: true, verify: true,
  },
};

const BOOKS = {
  dzikir: {
    epub: path.join(ROOT, 'dist', 'Dzikir Pagi Petang', 'epub', 'Universal', 'dzikir pagi petang.epub'),
    pdf: path.join(ROOT, 'dist', 'Dzikir Pagi Petang', 'pdf', 'Universal', 'Dzikir Pagi dan Petang.pdf'),
    pdfX4: path.join(ROOT, 'dist', 'Dzikir Pagi Petang', 'pdf', 'Xteink-X4', 'Dzikir Pagi dan Petang Xteink X4.pdf'),
    // User asked to swap the text cover for this image.
    coverImage: path.join(ROOT, 'assets', 'cover_dzikirpagipetang.jpg'),
    arabicSelector: '.arabic-text',
    // Hierarchical bookmarks like the reference (group → items). Pagi = d1–d18,
    // Petang = d19–d35. Non-matching pages get no bookmark.
    outlineGroups: [
      { title: 'Dzikir Pagi', match: /(?:^|\/)dzikir-(?:[1-9]|1[0-8])\.xhtml$/ },
      { title: 'Dzikir Petang', match: /(?:^|\/)dzikir-(?:19|2\d|3[0-5])\.xhtml$/ },
    ],
    // Make the Arabic follow Al-Quran-Arabic.xtcz exactly: same font (LPMQ Isep
    // Misbah), same size/line-height as the Xteink X4 Quran render, bold.
    arabic: {
      selector: '.arabic-text',
      font: QURAN_FONT,
      px: X4_ARABIC.arabicPx,
      lineHeight: X4_ARABIC.arabicLineHeight
    }
  },
  juzamma: {
    epub: path.join(ROOT, 'dist', 'Juz Amma', 'epub', 'Universal', "Juz 'Amma & Terjemahan.epub"),
    pdf: path.join(ROOT, 'dist', 'Juz Amma', 'pdf', 'Universal', "Juz 'Amma & Terjemahan.pdf"),
    pdfX4: path.join(ROOT, 'dist', 'Juz Amma', 'pdf', 'Xteink-X4', "Juz 'Amma & Terjemahan Xteink X4.pdf"),
    // Keep the EPUB's own cover image, but trim its white mockup border/shadow
    // so the cover artwork fills the page edge-to-edge.
    coverImage: null,
    trimCover: true,
    arabicSelector: '.teks-arab',
    // Every Arabic-bearing element → Kemenag (title, basmalah, ayah numbers too).
    arabicFamilySelectors: '.teks-arab,.judul-surah,.basmalah,.nomor-ayat',
    // The EPUB's 'QuranArabic' @font-face points at Scheherazade; repoint it to
    // the Kemenag font so inherited Arabic (TOC surah names, title page) matches.
    swapArabicFontFiles: ['ScheherazadeNew-Regular.ttf'],
    // Hierarchical bookmarks like the reference: one "Juz 30" group → all surahs.
    outlineGroups: [{ title: 'Juz 30', match: /surah-\d+\.xhtml$/ }],
    // Make the daftar isi follow Al-Quran.pdf: centered heading, Juz group label
    // "Juz 30 — الجزء ٣٠", and no list markers (so surah lines aren't double-numbered).
    htmlReplace: [{ from: "Juz 'Amma (Juz 30)", to: 'Juz 30 — الجزء ٣٠' }],
    extraCss: `nav[role="doc-toc"] h1{text-align:center!important}
nav[role="doc-toc"] ol{list-style:none;padding:0;margin:.3em 0}
nav[role="doc-toc"] ol ol{padding-inline-start:1.4em}
nav[role="doc-toc"] li{margin:.15em 0}`
  },
  alquran: {
    epub: path.join(ROOT, 'dist', 'Al-Quran', 'epub', 'Universal', 'Al-Quran.epub'),
    pdf: path.join(ROOT, 'dist', 'Al-Quran', 'pdf', 'Universal', 'Al-Quran.pdf'),
    pdfX4: path.join(ROOT, 'dist', 'Al-Quran', 'pdf', 'Xteink-X4', 'Al-Quran Xteink X4.pdf'),
    // Keep the ornate "al-Qur'an al-Karim" cover — do NOT replace it. Uses the
    // white-padded copy so coverFit:'cover' shows the full border without cropping.
    coverImage: path.join(ROOT, 'assets', 'alquran_karim_cover_pdf.jpg'),
    arabicSelector: '.quran-flow',
    // Every Arabic-bearing element → Kemenag (verses, surah names, bismillah,
    // ayah + page numbers), matching the Juz 'Amma X4 look.
    arabicFamilySelectors: '.quran-flow,.surah-name-ar,.bismillah,.ayah-num,.page-num',
    // The EPUB's 'QuranArabic' @font-face points at the edition font (IndoPak =
    // Scheherazade, Uthmani = UthmanicHafs); repoint it to the Kemenag font so
    // inherited Arabic (TOC surah names) matches too.
    swapArabicFontFiles: ['ScheherazadeNew-Regular.ttf', 'UthmanicHafs.otf'],
    // Universal profile also bakes the Kemenag font (comfortable A5 size).
    arabic: {
      selector: '.quran-flow',
      familySelectors: '.quran-flow,.surah-name-ar,.bismillah,.ayah-num,.page-num',
      font: QURAN_FONT,
      px: 23,
      lineHeight: 2.0,
    },
    // One "al-Qur'an" group → all 114 surahs, so the .xtcz chapter list fills.
    outlineGroups: [{ title: 'Al-Qur’an al-Karim', match: /surah-\d+\.xhtml$/ }],
    // The EPUB frames each mushaf page in a bordered `.page` box with a forced
    // page break before it. On the small X4 sheet a mushaf page is taller than
    // one PDF page, so the box split and its trailing `.page-num` orphaned onto
    // an otherwise-blank page. Flow the verses continuously instead (no boxes,
    // no forced breaks) so every PDF page fills and none are left number-only.
    extraCss: `.page{border:0!important;padding:0!important;margin:0 0 .15em!important;page-break-before:auto!important;break-before:auto!important;break-inside:auto!important}
.page-num{display:none!important}
nav[role="doc-toc"] ol{list-style:none;padding:0;margin:.3em 0}
nav[role="doc-toc"] ol ol{padding-inline-start:1.4em}
nav[role="doc-toc"] li{margin:.15em 0}`,
  },
  terjemah: {
    // Bilingual: Arabic + per-ayah Indonesian (Kemenag) translation cards.
    epub: path.join(ROOT, 'dist', 'Al Quran dan Terjemahnya (Bahasa Indonesia)', 'epub', 'Universal', 'Al Quran dan Terjemahnya (Bahasa Indonesia).epub'),
    pdf: path.join(ROOT, 'dist', 'Al Quran dan Terjemahnya (Bahasa Indonesia)', 'pdf', 'Kobo-Clara', 'Al Quran dan Terjemahnya (Clara).pdf'),
    pdfX4: path.join(ROOT, 'dist', 'Al Quran dan Terjemahnya (Bahasa Indonesia)', 'pdf', 'Xteink-X4', 'Al Quran dan Terjemahnya Xteink X4.pdf'),
    coverImage: path.join(ROOT, 'assets', 'al-quran-bahasa-indonesia.png'),
    arabicSelector: '.arabic',
    // Arabic-bearing bits of the verse card + surah banner -> Kemenag font.
    arabicFamilySelectors: '.arabic,.surah-title,.ayah-num',
    swapArabicFontFiles: ['ScheherazadeNew-Regular.ttf'],
    arabic: {
      selector: '.arabic',
      familySelectors: '.arabic,.surah-title,.ayah-num',
      font: QURAN_FONT,
      px: 23,
      lineHeight: 2.0,
    },
    // One group -> all 114 surahs so the TOC/chapter list fills.
    outlineGroups: [{ title: 'Al-Qur’an dan Terjemahnya', match: /surah-\d+\.xhtml$/ }],
    // UNBOX the verse card: the 1px rounded frame + fat padding + 1em gap eat
    // a lot of the small page. A thin dotted rule under each verse keeps the
    // separation; the Arabic/translation divider stays but hugs tighter.
    extraCss: `.verse{border:0!important;border-radius:0!important;padding:0 0 .3em!important;margin:0 0 .4em!important;border-bottom:1px dotted #888!important}
.translation{border-top:0!important;padding-top:.1em!important;margin:.15em 0 0!important}
nav[role="doc-toc"] ol{list-style:none;padding:0;margin:.3em 0}
nav[role="doc-toc"] ol ol{padding-inline-start:1.4em}
nav[role="doc-toc"] li{margin:.15em 0}`,
  }
};

function printCss(p) {
  return `
@page{size:${p.widthMm}mm ${p.heightMm}mm;margin:${p.marginCss}}
@page cover{margin:0}
html,body{margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
.pdf-cover{page:cover;width:${p.widthMm}mm;height:${p.heightMm}mm;margin:0;padding:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#ffffff;page-break-after:always;break-after:page}
.pdf-cover img{width:100%;height:100%;object-fit:${p.coverFit};object-position:center;display:block;max-width:none;max-height:none}
.pdf-chapter{page-break-before:always;break-before:page}
`;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  if (process.platform === 'win32') {
    for (const executable of ['chrome.exe', 'msedge.exe']) {
      try {
        const found = execFileSync('where.exe', [executable], { encoding: 'utf8' })
          .split(/\r?\n/).map(line => line.trim()).find(Boolean);
        if (found) return found;
      } catch {}
    }
  }

  throw new Error('Chrome or Microsoft Edge was not found. Set CHROME_PATH to its executable.');
}

// Some cover artworks ship as a 3D book mockup: the real front-cover face sits on
// a white background with a light "pages" strip down one side and a drop shadow.
// Plain whitespace-trim leaves the grey page strip behind, so instead we detect the
// bounding box of the dark cover face and crop to exactly that.
async function cropCoverFace(inputBuffer) {
  const { data, info } = await sharp(inputBuffer).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const lum = (x, y) => { const i = (y * W + x) * C; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const colDark = x => { let d = 0; for (let y = 0; y < H; y++) if (lum(x, y) < 110) d++; return d / H; };
  const rowDark = y => { let d = 0; for (let x = 0; x < W; x++) if (lum(x, y) < 110) d++; return d / W; };
  const TH = 0.5; // a column/row at least half dark is inside the cover face
  let x0 = 0; while (x0 < W && colDark(x0) < TH) x0++;
  let x1 = W - 1; while (x1 > x0 && colDark(x1) < TH) x1--;
  let y0 = 0; while (y0 < H && rowDark(y0) < TH) y0++;
  let y1 = H - 1; while (y1 > y0 && rowDark(y1) < TH) y1--;
  if (x1 <= x0 || y1 <= y0) return sharp(inputBuffer).jpeg({ quality: 92 }).toBuffer(); // light cover: leave as-is
  return sharp(inputBuffer)
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .jpeg({ quality: 92 })
    .toBuffer();
}

function safeJoin(baseDir, relativeName) {
  const fullPath = path.resolve(baseDir, ...relativeName.split('/'));
  if (fullPath !== baseDir && !fullPath.startsWith(baseDir + path.sep)) {
    throw new Error(`Unsafe path in EPUB archive: ${relativeName}`);
  }
  return fullPath;
}

// Resolve a relative resource reference found inside a spine document (which
// lives in `docDir`, posix-relative to the OPF root) to a path relative to that
// same root, so it stays valid once every body is merged at the root.
function rewriteUrl(value, docDir) {
  const trimmed = value.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(trimmed)) return value;
  return path.posix.normalize(path.posix.join(docDir, trimmed));
}

// Links that point at another spine document become in-PDF anchor jumps so the
// table-of-contents pages are clickable; everything else is resolved as a file path.
function rewriteHref(value, docDir, anchors) {
  const trimmed = value.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/|#|data:)/i.test(trimmed)) return value;
  const pathPart = trimmed.split('#')[0];
  const target = path.posix.normalize(path.posix.join(docDir, pathPart));
  if (anchors.has(target)) return `#${anchors.get(target)}`;
  return rewriteUrl(value, docDir);
}

function rewriteBodyUrls(body, docDir, anchors) {
  // src / xlink:href resource attributes
  body = body.replace(/\b(src|xlink:href)\s*=\s*(["'])(.*?)\2/gi,
    (match, attr, quote, value) => `${attr}=${quote}${rewriteUrl(value, docDir)}${quote}`);
  // href links (may target another spine doc -> anchor)
  body = body.replace(/\bhref\s*=\s*(["'])(.*?)\1/gi,
    (match, quote, value) => `href=${quote}${rewriteHref(value, docDir, anchors)}${quote}`);
  // url(...) inside inline styles
  body = body.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi,
    (match, quote, value) => `url(${quote}${rewriteUrl(value, docDir)}${quote})`);
  return body;
}

function parseOpf(opfText, opfDir) {
  const manifest = {};
  const itemRe = /<item\b[^>]*?>/gi;
  let m;
  while ((m = itemRe.exec(opfText))) {
    const tag = m[0];
    const id = (tag.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    const props = (tag.match(/\bproperties\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (id && href) manifest[id] = { href, properties: props };
  }

  const spine = [];
  const spineRe = /<itemref\b[^>]*?idref\s*=\s*["']([^"']+)["'][^>]*?>/gi;
  while ((m = spineRe.exec(opfText))) {
    const item = manifest[m[1]];
    if (item) spine.push(item.href);
  }

  // Cover image: <meta name="cover" content="ID"> or item properties="cover-image".
  let coverHref = null;
  const metaCover = opfText.match(/<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i)
    || opfText.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bname\s*=\s*["']cover["']/i);
  if (metaCover && manifest[metaCover[1]]) {
    coverHref = manifest[metaCover[1]].href;
  } else {
    const byProp = Object.values(manifest).find(item => /\bcover-image\b/.test(item.properties));
    if (byProp) coverHref = byProp.href;
  }

  return {
    spine: spine.map(href => path.posix.normalize(path.posix.join(opfDir, href))),
    coverImage: coverHref ? path.posix.normalize(path.posix.join(opfDir, coverHref)) : null
  };
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

function extractBodyAndHead(xhtml, filename) {
  const bodyMatch = xhtml.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) throw new Error(`No <body> found in ${filename}`);
  const bodyClass = (bodyMatch[1].match(/\bclass\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
  const headMatch = xhtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const titleMatch = xhtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';
  return { bodyClass, body: bodyMatch[2], head: headMatch ? headMatch[1] : '', title };
}

function collectStyleRefs(head, docDir, links, inlineStyles) {
  const linkRe = /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi;
  let m;
  while ((m = linkRe.exec(head))) {
    const href = (m[0].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (href) links.add(rewriteUrl(href, docDir));
  }
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(head))) inlineStyles.add(m[1]);
}

async function convert(zip, book, tempDir, profile) {
  const outPdf = book[profile.pdfKey];
  if (!outPdf) throw new Error(`Book has no output path for the "${profile.pdfKey}" profile.`);
  const workDir = path.join(tempDir, 'epub');
  fs.mkdirSync(workDir, { recursive: true });

  // Extract every file, preserving structure.
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const target = safeJoin(workDir, entryName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async('nodebuffer'));
  }

  // Locate the OPF via container.xml.
  const container = fs.readFileSync(path.join(workDir, 'META-INF', 'container.xml'), 'utf8');
  const opfRel = (container.match(/\bfull-path\s*=\s*["']([^"']+)["']/i) || [])[1];
  if (!opfRel) throw new Error('Could not find the OPF path in META-INF/container.xml.');
  const opfDir = path.posix.dirname(opfRel.replace(/\\/g, '/'));
  const rootDir = safeJoin(workDir, opfDir === '.' ? '' : opfDir);
  const opfText = fs.readFileSync(safeJoin(workDir, opfRel), 'utf8');
  const { spine, coverImage } = parseOpf(opfText, opfDir === '.' ? '' : opfDir);
  if (spine.length === 0) throw new Error('The EPUB spine is empty.');

  // Resolve the cover source: explicit override, else the EPUB's own cover image.
  // When `trimCover` is set, the white mockup border/shadow is trimmed so the
  // artwork fills the page; a trim also forces us through the sharp re-encode path.
  let coverRelToRoot;
  const coverSource = book.coverImage || (coverImage ? safeJoin(workDir, coverImage) : null);
  if (!coverSource) throw new Error('No cover image available and none provided.');
  if (book.coverImage && !fs.existsSync(book.coverImage)) {
    throw new Error(`Cover image not found: ${book.coverImage}`);
  }

  if (book.trimCover) {
    const imagesDir = path.join(rootDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const cropped = await cropCoverFace(fs.readFileSync(coverSource));
    fs.writeFileSync(path.join(imagesDir, 'pdf-cover.jpg'), cropped);
    coverRelToRoot = 'images/pdf-cover.jpg';
  } else if (book.coverImage) {
    const imagesDir = path.join(rootDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    const ext = path.extname(book.coverImage) || '.jpg';
    fs.copyFileSync(book.coverImage, path.join(imagesDir, `pdf-cover${ext}`));
    coverRelToRoot = `images/pdf-cover${ext}`;
  } else {
    coverRelToRoot = path.posix.relative(opfDir === '.' ? '' : opfDir, coverImage);
  }

  const links = new Set();
  const inlineStyles = new Set();
  const chapters = [];
  const outlineItems = [];

  // Give every spine document (except the cover we replace) a stable anchor id,
  // keyed by its OPF-root-relative path, so TOC links can resolve to #anchors.
  const opfRoot = opfDir === '.' ? '' : opfDir;
  const anchors = new Map();
  for (let i = 1; i < spine.length; i++) {
    anchors.set(path.posix.relative(opfRoot, spine[i]), `pdfnav-${i}`);
  }

  // Skip the first spine document (the original cover page) — we render our own.
  for (let i = 1; i < spine.length; i++) {
    const docAbs = safeJoin(workDir, spine[i]);
    if (!fs.existsSync(docAbs)) continue;
    const docDirRelToRoot = path.posix.dirname(path.posix.relative(opfRoot, spine[i]));
    const docDir = docDirRelToRoot === '.' ? '' : docDirRelToRoot;
    const xhtml = fs.readFileSync(docAbs, 'utf8');
    const { bodyClass, body, head, title } = extractBodyAndHead(xhtml, spine[i]);
    collectStyleRefs(head, docDir, links, inlineStyles);
    const cls = ['pdf-chapter', bodyClass].filter(Boolean).join(' ');
    let rewritten = rewriteBodyUrls(body, docDir, anchors);
    for (const { from, to } of book.htmlReplace || []) rewritten = rewritten.split(from).join(to);
    chapters.push(`<section id="pdfnav-${i}" class="${cls}">${rewritten}</section>`);
    // Collect a PDF bookmark per chapter; the official Xteink converter builds
    // the .xtcz chapter list from the PDF outline, which Chrome doesn't emit.
    if (title) outlineItems.push({ name: `pdfnav-${i}`, title, spinePath: path.posix.relative(opfRoot, spine[i]) });
  }

  const styleLinks = [...links].map(href => `<link rel="stylesheet" href="${href}"/>`).join('\n');
  const styleBlocks = [...inlineStyles].map(css => `<style>${css}</style>`).join('\n');
  const coverSection = `<section class="pdf-cover"><img src="${coverRelToRoot}" alt="Cover"/></section>`;

  // Bake the Kemenag (LPMQ Isep Misbah) Arabic font + sizing. For the X4 profile
  // every book gets it (so the X4 renders pre-shaped glyphs, not its limited
  // device font); otherwise use the book's own `arabic`. A dedicated family name
  // ('KemenagArabic') sidesteps the EPUB's own 'QuranArabic' face, so EVERY
  // Arabic element switches to Kemenag — not just the main verse selector.
  const arabic = profile.bakeArabic && book.arabicSelector
    ? {
        selector: book.arabicSelector,
        familySelectors: book.arabicFamilySelectors || book.arabicSelector,
        font: QURAN_FONT,
        px: profile.arabicPx || X4_ARABIC.arabicPx,
        lineHeight: profile.arabicLineHeight || X4_ARABIC.arabicLineHeight,
      }
    : book.arabic;
  let arabicCss = '';
  if (arabic) {
    const font = arabic.font;
    if (!fs.existsSync(font.src)) throw new Error(`Arabic font not found: ${font.src}`);
    const fontsDir = path.join(rootDir, 'fonts');
    fs.mkdirSync(fontsDir, { recursive: true });
    fs.copyFileSync(font.src, path.join(fontsDir, font.file));
    const famSelectors = arabic.familySelectors || arabic.selector;
    arabicCss = `@font-face{font-family:'KemenagArabic';font-style:normal;font-weight:400;src:url('fonts/${font.file}') format('${font.fmt}')}
${famSelectors}{font-family:'KemenagArabic','Amiri','Noto Naskh Arabic',serif!important}
${arabic.selector}{font-size:${arabic.px}px!important;line-height:${arabic.lineHeight}!important;font-weight:bold!important}`;

    // Repoint the EPUB's own Arabic @font-face at the Kemenag font so text that
    // inherits it (TOC surah names, title page) switches over too — no stray face.
    if (book.swapArabicFontFiles && book.swapArabicFontFiles.length) {
      for (const href of links) {
        const cssPath = safeJoin(workDir, path.posix.join(opfRoot, href));
        if (!fs.existsSync(cssPath)) continue;
        let css = fs.readFileSync(cssPath, 'utf8');
        let changed = false;
        for (const from of book.swapArabicFontFiles) {
          if (css.includes(from)) { css = css.split(from).join(font.file); changed = true; }
        }
        if (changed) fs.writeFileSync(cssPath, css, 'utf8');
      }
    }
  }

  const printable = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ar">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${path.basename(outPdf, '.pdf')}</title>
${styleLinks}
${styleBlocks}
<style>${printCss(profile)}
${arabicCss}
${book.extraCss || ''}</style></head>
<body>${coverSection}${chapters.join('\n')}</body></html>`;

  const printHtml = path.join(rootDir, 'print.html');
  fs.writeFileSync(printHtml, printable, 'utf8');

  const chrome = findChrome();
  const profileDir = path.join(tempDir, 'chrome-profile');
  fs.mkdirSync(path.dirname(outPdf), { recursive: true });
  if (fs.existsSync(outPdf)) fs.unlinkSync(outPdf);

  const result = spawnSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--no-pdf-header-footer',
    `--user-data-dir=${profileDir}`,
    `--print-to-pdf=${outPdf}`,
    pathToFileURL(printHtml).href
  ], { encoding: 'utf8', timeout: 180000 });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`PDF rendering failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  if (!fs.existsSync(outPdf)) throw new Error('Chrome finished without creating the PDF.');

  const data = fs.readFileSync(outPdf);
  const pdfText = data.toString('latin1');
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdfText.trimEnd().endsWith('%%EOF')) {
    throw new Error('Chrome did not produce a complete PDF.');
  }
  if (pageCount === 0) throw new Error('The produced PDF has no pages.');

  const outline = buildOutlineTree(outlineItems, book.outlineGroups);
  const outlineAdded = addPdfOutline(outPdf, outline, tempDir);
  if (profile.requireOutline && outline.length && !outlineAdded) {
    throw new Error(
      'Xteink X4 PDF needs chapter bookmarks but PyMuPDF/Python is unavailable. ' +
      'Install it (`pip install pymupdf`) and rebuild — without bookmarks the .xtcz chapter list is empty.'
    );
  }
  if (profile.verify) assertDevicePdf(outPdf, profile, outline.length);
  return pageCount;
}

// Turn the flat per-chapter list into a (possibly hierarchical) outline like the
// reference Al-Quran.pdf: each group (e.g. "Juz 30") at level 1 with its chapters
// nested at level 2. Group headers point at their first child's destination. With
// no groups, every chapter is a flat level-1 bookmark. Chapters that match no
// group are dropped (reference-style: only grouped content is bookmarked).
function buildOutlineTree(items, groups) {
  if (!groups || !groups.length) {
    return items.map(it => ({ level: 1, title: it.title, name: it.name }));
  }
  const out = [];
  const opened = new Set();
  for (const it of items) {
    const g = groups.find(grp => grp.match.test(it.spinePath));
    if (!g) continue;
    if (!opened.has(g.title)) { out.push({ level: 1, title: g.title, name: it.name }); opened.add(g.title); }
    out.push({ level: 2, title: it.title, name: it.name });
  }
  return out;
}

// Add a PDF outline (bookmarks) via PyMuPDF — Chrome's print-to-pdf emits named
// destinations but no outline, and the official Xteink converter builds the
// .xtcz chapter list from that outline. Returns true on success.
function addPdfOutline(pdfPath, items, tempDir) {
  if (!items.length) return true;
  const jsonPath = path.join(tempDir, 'outline.json');
  fs.writeFileSync(jsonPath, JSON.stringify(items), 'utf8');
  const script = path.join(ROOT, 'add-pdf-outline.py');
  let lastErr = '';
  for (const py of [process.env.PYTHON, 'python', 'py'].filter(Boolean)) {
    const r = spawnSync(py, [script, pdfPath, jsonPath], { encoding: 'utf8' });
    if (!r.error && r.status === 0) {
      console.log(`  + outline: ${(r.stdout || '').trim() || `${items.length} bookmarks`}`);
      return true;
    }
    lastErr = (r.error && r.error.message) || r.stderr || r.stdout || '';
  }
  console.warn(`  ! outline skipped (need Python + PyMuPDF): ${lastErr.trim().split('\n').pop()}`);
  return false;
}

// Enforce the Xteink device rules on the finished PDF so a bad build fails loudly
// instead of shipping a file that won't list/trigger on the device.
function assertDevicePdf(pdfPath, profile, bookmarkCount) {
  const t = fs.readFileSync(pdfPath).toString('latin1');
  const expW = profile.widthMm * 72 / MM_PER_IN;
  const expH = profile.heightMm * 72 / MM_PER_IN;
  const boxes = [...t.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
    .map(m => m[1].trim().split(/\s+/).map(Number));
  if (!boxes.length || boxes.some(b => Math.abs(b[2] - expW) > 0.5 || Math.abs(b[3] - expH) > 0.5)) {
    throw new Error(`Device PDF page size wrong — expected ${expW.toFixed(1)}×${expH.toFixed(1)} pt (${profile.widthMm}×${profile.heightMm} mm, patokan Al-Quran.pdf).`);
  }
  if (bookmarkCount && !/\/Outlines\b/.test(t)) {
    throw new Error('Device PDF is missing /Outlines (chapter bookmarks for the .xtcz list).');
  }
  const fonts = [...new Set([...t.matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([A-Za-z0-9-]+)/g)].map(m => m[1]))];
  const stray = fonts.filter(f => /Scheherazade|Amiri|Noto|Naskh|Uthman|KFGQPC/i.test(f));
  if (stray.length) {
    throw new Error(`Device PDF has non-Kemenag Arabic font(s): ${stray.join(', ')} — all Arabic must be baked as LPMQ.`);
  }
  console.log(`  ✓ verified: ${expW.toFixed(1)}×${expH.toFixed(1)}pt · ${bookmarkCount} bookmarks · Arabic = Kemenag only`);
}

async function buildBook(key, profile) {
  const book = BOOKS[key];
  if (!book) throw new Error(`Unknown book "${key}". Choose from: ${Object.keys(BOOKS).join(', ')}.`);
  if (!fs.existsSync(book.epub)) throw new Error(`EPUB not found: ${book.epub}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-pdf-'));
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(book.epub));
    const pages = await convert(zip, book, tempDir, profile);
    console.log(`Created ${path.relative(ROOT, book[profile.pdfKey])} (${pages} pages).`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  // Args (any order): a book (dzikir|juzamma|all) and a profile (universal|x4).
  const args = process.argv.slice(2).map(a => a.toLowerCase());
  const profileKey = args.find(a => PROFILES[a]) || 'universal';
  const bookArg = args.find(a => a === 'all' || BOOKS[a]) || 'all';
  const keys = bookArg === 'all' ? Object.keys(BOOKS) : [bookArg];
  for (const key of keys) await buildBook(key, PROFILES[profileKey]);
}

main().catch(error => {
  console.error(`Failed to build PDF: ${error.message}`);
  process.exitCode = 1;
});
