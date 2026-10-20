/* =============================================================================
 * builder.js — Mushaf-style EPUB 3 generator
 * -----------------------------------------------------------------------------
 * Produces two EPUB 3 files from the quran.com API v4:
 *   1. Al-Quran_Arab_Only_Uthmani.epub   (pure Arabic, Uthmani script)
 *   2. Al-Quran_Indonesia_Kemenag.epub   (Arabic Imla'i + Indonesian Kemenag)
 *
 * Usage:
 *   node builder.js                 build both editions
 *   node builder.js --only=arab     build Arabic-only edition
 *   node builder.js --only=indo     build Indonesian edition
 *   node builder.js --offline       reuse cached API data in ./.cache
 *
 * Output: ./dist/<filename>.epub
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const JSZip = require('jszip');
const { validateEpubBuffer } = require('./validate');

/* ----------------------------------------------------------------------------
 * Paths & constants
 * ------------------------------------------------------------------------- */
const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache');
const FONTS_DIR = path.join(ROOT, 'fonts');
const ASSETS_DIR = path.join(ROOT, 'assets');
const TEMPLATES_DIR = path.join(ROOT, 'templates');

const API = 'https://api.quran.com/api/v4';
const PER_PAGE = 50; // quran.com caps verses/by_chapter at 50 per page

const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').split('=')[1] || null;
const OFFLINE = ARGS.includes('--offline');

/* Bismillah (shown as a decorative line before every surah except 1 and 9). */
const BISMILLAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

/* ----------------------------------------------------------------------------
 * Edition configuration
 * ------------------------------------------------------------------------- */
const EDITIONS = {
  arab: {
    id: 'arab',
    filename: 'Al-Quran (Uthmani Format).epub',
    bookTitle: 'القرآن الكريم',
    bookSubtitle: 'Mushaf Utsmani (Hafs)',
    language: 'ar',
    pageDir: 'rtl',
    bilingual: false,
    arabicField: 'text_uthmani',
    translationId: null,
    chapterLang: 'en', // language for surah names / translated_name
    // Font families tried in order; first file found in ./fonts wins.
    fontCandidates: [
      'UthmanicHafs.otf', 'UthmanicHafs.ttf', 'UthmanicHafs1Ver18.ttf',
      'KFGQPC-Uthmanic-Script-HAFS.ttf', 'KFGQPCUthmanicScriptHAFS.ttf',
      'AmiriQuran-Regular.ttf', 'AmiriQuran.ttf'
    ],
    fontAutoDownload: {
      file: 'AmiriQuran-Regular.ttf',
      url: 'https://github.com/google/fonts/raw/main/ofl/amiriquran/AmiriQuran-Regular.ttf'
    }
  },
  indopak: {
    id: 'indopak',
    filename: 'Al-Quran (IndoPak Format).epub',
    bookTitle: 'القرآن الكريم',
    bookSubtitle: 'Mushaf IndoPak',
    language: 'ar',
    pageDir: 'rtl',
    bilingual: false,
    arabicField: 'text_indopak',
    translationId: null,
    chapterLang: 'en', // surah name meanings (Arabic-only edition)
    // Drop your IndoPak font into ./fonts or ./assets/fonts; first match wins.
    // Common names supported below. Falls back to Scheherazade New (OFL, already present).
    fontCandidates: [
      'IndoPak.ttf', 'IndoPak.otf', 'me_quran.ttf', 'me_quran.otf',
      'AlQalam.ttf', 'AlQalamQuran.ttf', 'PDMS_Saleem_QuranFont.ttf',
      'NotoNastaliqUrdu-Regular.ttf', 'Noto_Nastaliq_Urdu.ttf',
      'ScheherazadeNew-Regular.ttf', 'ScheherazadeNew.ttf'
    ],
    fontAutoDownload: {
      file: 'ScheherazadeNew-Regular.ttf',
      url: 'https://github.com/google/fonts/raw/main/ofl/scheherazadenew/ScheherazadeNew-Regular.ttf'
    }
  }
};

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/** Convert Western digits to Eastern Arabic numerals (١٢٣…). */
const toArabicNumerals = (num) =>
  num.toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

const pad3 = (n) => String(n).padStart(3, '0');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Minimal XML/HTML escape for text nodes and attributes. */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

/** GET with retry + exponential backoff, plus a tiny on-disk cache. */
async function apiGet(url, params = {}, cacheKey = null) {
  if (cacheKey) {
    const cp = path.join(CACHE, cacheKey + '.json');
    if (OFFLINE || fs.existsSync(cp)) {
      if (fs.existsSync(cp)) return JSON.parse(fs.readFileSync(cp, 'utf8'));
      if (OFFLINE) throw new Error(`--offline set but cache missing: ${cacheKey}`);
    }
  }
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await axios.get(url, { params, timeout: 30000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'quran-epub-builder/1.0' } });
      if (cacheKey) {
        ensureDir(CACHE);
        fs.writeFileSync(path.join(CACHE, cacheKey + '.json'), JSON.stringify(res.data));
      }
      return res.data;
    } catch (err) {
      lastErr = err;
      const wait = Math.min(1000 * 2 ** (attempt - 1), 8000);
      process.stdout.write(`\n  ! ${url} failed (attempt ${attempt}/5): ${err.message}. retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/* ----------------------------------------------------------------------------
 * Data fetching
 * ------------------------------------------------------------------------- */

async function fetchChapters(language = 'en') {
  const data = await apiGet(`${API}/chapters`, { language }, `chapters_${language}`);
  return data.chapters; // id, name_simple, name_arabic, name_complex, translated_name, verses_count, bismillah_pre, revelation_place
}

async function fetchJuzs() {
  const data = await apiGet(`${API}/juzs`, {}, 'juzs');
  // quran.com v4 now returns 60 half-juz entries (each juz_number appears twice).
  // Consolidate to the 30 classic juz, merging verse_mapping per chapter.
  const byNum = new Map();
  for (const j of data.juzs) {
    let entry = byNum.get(j.juz_number);
    if (!entry) { entry = { juz_number: j.juz_number, verse_mapping: {} }; byNum.set(j.juz_number, entry); }
    for (const [ch, range] of Object.entries(j.verse_mapping)) {
      const [s, e] = String(range).split('-').map(n => parseInt(n, 10));
      const prev = entry.verse_mapping[ch];
      if (!prev) { entry.verse_mapping[ch] = `${s}-${e}`; }
      else {
        const [ps, pe] = prev.split('-').map(n => parseInt(n, 10));
        entry.verse_mapping[ch] = `${Math.min(ps, s)}-${Math.max(pe, e)}`;
      }
    }
  }
  return [...byNum.values()].sort((a, b) => a.juz_number - b.juz_number);
}

/** Verify/resolve the Indonesian Kemenag translation id against the API. */
async function resolveTranslationId(fallback) {
  try {
    const data = await apiGet(`${API}/resources/translations`, {}, 'translations');
    const list = data.translations || [];
    const match = list.find(t =>
      /indonesian/i.test(t.language_name || '') &&
      /(ministry|kemenag|agama|affairs)/i.test(`${t.name} ${t.author_name || ''}`));
    if (match) {
      console.log(`  → Kemenag translation resolved: id=${match.id} "${match.name}"`);
      return match.id;
    }
  } catch (e) {
    console.log(`  ! translation lookup failed (${e.message}); using fallback id=${fallback}`);
  }
  return fallback;
}

/** Fetch all verses of a chapter (handles pagination). */
async function fetchVerses(chapterId, { fields, translations }) {
  const all = [];
  let page = 1;
  for (;;) {
    const params = { fields, per_page: PER_PAGE, page };
    if (translations) params.translations = translations;
    const key = `verses_${chapterId}_${fields}_${translations || 'none'}_p${page}`;
    const data = await apiGet(`${API}/verses/by_chapter/${chapterId}`, params, key);
    all.push(...data.verses);
    const next = data.pagination && data.pagination.next_page;
    if (!next) break;
    page = next;
  }
  return all;
}

/* ----------------------------------------------------------------------------
 * Font resolution (+ auto-download of OFL fallbacks)
 * ------------------------------------------------------------------------- */
async function resolveFont(edition) {
  ensureDir(FONTS_DIR);
  // 1) prefer any user-supplied candidate already present (search both ./fonts and ./assets/fonts)
  const searchDirs = [FONTS_DIR, path.join(ASSETS_DIR, 'fonts')];
  for (const name of edition.fontCandidates) {
    for (const dir of searchDirs) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return { file: name, path: p };
    }
  }
  // 2) auto-download the OFL fallback
  const dl = edition.fontAutoDownload;
  const target = path.join(FONTS_DIR, dl.file);
  if (!fs.existsSync(target)) {
    try {
      console.log(`  ↓ downloading fallback font ${dl.file} …`);
      const res = await axios.get(dl.url, { responseType: 'arraybuffer', timeout: 60000,
        headers: { 'User-Agent': 'quran-epub-builder/1.0' } });
      fs.writeFileSync(target, Buffer.from(res.data));
    } catch (e) {
      console.log(`  ! could not download fallback font: ${e.message}`);
      return null; // build continues; reader falls back to a system Arabic font
    }
  }
  return { file: dl.file, path: target };
}

function fontMediaType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.otf') return 'application/vnd.ms-opentype';
  if (ext === '.woff') return 'application/font-woff';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/font-sfnt'; // .ttf — accepted by EPUBCheck + Amazon
}
function fontCssFormat(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.otf') return 'opentype';
  if (ext === '.woff') return 'woff';
  if (ext === '.woff2') return 'woff2';
  return 'truetype';
}

/* ----------------------------------------------------------------------------
 * Static asset generators (SVG ornaments + border frames)
 * ------------------------------------------------------------------------- */

/** Ornamental rectangular frame (border-image). `stroke` lets us theme it. */
function borderSvg(stroke) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <pattern id="vine" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M0 15 q7.5 -12 15 0 q7.5 12 15 0" fill="none" stroke="${stroke}" stroke-width="2"/>
      <circle cx="15" cy="15" r="2.2" fill="${stroke}"/>
    </pattern>
  </defs>
  <rect x="6" y="6" width="288" height="288" fill="none" stroke="${stroke}" stroke-width="3"/>
  <rect x="16" y="16" width="268" height="268" fill="none" stroke="${stroke}" stroke-width="1.5"/>
  <rect x="22" y="22" width="256" height="256" fill="url(#vine)" opacity="0.9"/>
  <rect x="34" y="34" width="232" height="232" fill="#fff0" stroke="none"/>
  <!-- corner florets -->
  ${[[26,26],[274,26],[26,274],[274,274]].map(([cx,cy]) => `
  <g transform="translate(${cx},${cy})">
    <circle r="9" fill="none" stroke="${stroke}" stroke-width="2"/>
    <circle r="3" fill="${stroke}"/>
    ${[0,45,90,135,180,225,270,315].map(a => `<path d="M0 0 L${(10*Math.cos(a*Math.PI/180)).toFixed(1)} ${(10*Math.sin(a*Math.PI/180)).toFixed(1)}" stroke="${stroke}" stroke-width="1.2"/>`).join('')}
  </g>`).join('')}
</svg>`;
}

/** Ayah-end rosette; the number is overlaid via CSS. */
function rosetteSvg(stroke) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <g transform="translate(50,50)">
    ${Array.from({ length: 16 }, (_, i) => {
      const a = (i * 22.5) * Math.PI / 180;
      return `<circle cx="${(38*Math.cos(a)).toFixed(1)}" cy="${(38*Math.sin(a)).toFixed(1)}" r="4.5" fill="none" stroke="${stroke}" stroke-width="2"/>`;
    }).join('')}
    <circle r="30" fill="none" stroke="${stroke}" stroke-width="2.5"/>
    <circle r="26" fill="#ffffff00" stroke="${stroke}" stroke-width="1"/>
  </g>
</svg>`;
}

/** Surah header banner (ornamental cartouche). Title text is laid over it in XHTML. */
function bannerSvg(stroke) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="140" viewBox="0 0 600 140" preserveAspectRatio="none">
  <rect x="8" y="8" width="584" height="124" rx="18" fill="none" stroke="${stroke}" stroke-width="3"/>
  <rect x="18" y="18" width="564" height="104" rx="12" fill="none" stroke="${stroke}" stroke-width="1.2"/>
  ${[30,570].map(x => `
  <g transform="translate(${x},70)">
    <circle r="12" fill="none" stroke="${stroke}" stroke-width="2"/>
    <circle r="4" fill="${stroke}"/>
  </g>`).join('')}
  <path d="M60 70 H540" stroke="${stroke}" stroke-width="0.8" stroke-dasharray="2 6" opacity="0.5"/>
</svg>`;
}

/* ----------------------------------------------------------------------------
 * CSS
 * ------------------------------------------------------------------------- */
function buildCss(fontFamilyFile) {
  // Prefer the standalone template as single source of truth; fall back to inline.
  const tpl = path.join(TEMPLATES_DIR, 'style.css');
  let css = fs.existsSync(tpl) ? fs.readFileSync(tpl, 'utf8') : INLINE_CSS;
  const face = fontFamilyFile
    ? `@font-face{font-family:'QuranArabic';font-style:normal;font-weight:400;font-display:swap;src:url('../fonts/${fontFamilyFile.file}') format('${fontCssFormat(fontFamilyFile.file)}');}`
    : `/* no embedded font found — using system Arabic fallback */`;
  return css.replace('/*__FONT_FACE__*/', face);
}

/* Inline CSS fallback (kept in sync with templates/style.css — E-INK SAFE:
   pure-CSS decoration, no SVG border-image/background, no box-shadow). */
const INLINE_CSS = `/*__FONT_FACE__*/
:root{--ink:#000;--paper:#fff;--muted:#2b2b2b;--rule:#000;}
*{box-sizing:border-box;}
html,body{margin:0;background:var(--paper);color:var(--ink);}
body{padding:0 4%;font-family:'QuranArabic',"Amiri Quran","Scheherazade New",serif;line-height:1.9;-webkit-hyphens:none;hyphens:none;}
.page{border:4px double var(--ink);padding:.7em .7em .9em;margin:.25em 0;page-break-before:always;break-before:page;}
.surah-banner{border:2px solid var(--ink);border-radius:10px;padding:.75em .5em;margin:.2em 0 1em;text-align:center;}
.surah-name-ar{font-family:'QuranArabic',serif;font-size:1.7em;line-height:1.4;}
.surah-name-tr{font-size:.95em;letter-spacing:.04em;color:var(--muted);margin-top:.15em;}
.surah-meta{font-size:.7em;color:var(--muted);margin-top:.2em;direction:rtl;}
.bismillah{font-family:'QuranArabic',serif;direction:rtl;text-align:center;font-size:1.5em;margin:.6em 0 1em;}
.surah-divider{display:block;margin:.2em auto 1.1em;width:60%;max-width:360px;height:auto;}
@media (prefers-color-scheme:dark){.surah-divider{filter:invert(1);}}
.quran-flow{direction:rtl;text-align:justify;text-align-last:center;font-family:'QuranArabic',serif;font-size:1.5em;line-height:2.1;}
.ayah{display:inline;}
.page-num{text-align:center;font-family:'QuranArabic',serif;font-size:.95em;color:var(--muted);margin:.7em 0 0;}
.ayah-num{font-family:'QuranArabic',"Scheherazade New",serif;display:inline-block;box-sizing:content-box;min-width:1.05em;padding:.06em .4em;margin:0 .35em;font-size:.6em;line-height:1.2;text-align:center;vertical-align:middle;color:var(--ink);background:var(--paper);border:1.5px solid var(--ink);border-radius:1.4em;}
/* bilingual (kept for future translated editions) */
.verse-card{margin:0 0 1.1em;padding:0 0 .9em;border-bottom:1px solid var(--rule);page-break-inside:avoid;break-inside:avoid;}
.verse-card:last-child{border-bottom:none;}
.verse-card .quran-flow{text-align:right;text-align-last:right;margin:0 0 .5em;}
.translation{direction:ltr;text-align:left;font-family:Georgia,"Times New Roman",serif;font-size:1em;line-height:1.7;color:var(--muted);}
.translation .tnum{font-weight:bold;color:var(--ink);margin-right:.3em;}
.toc-juz{font-weight:bold;}
h1,h2{text-align:center;font-weight:normal;}
.cover-wrap{margin:0;padding:0;text-align:center;}
.cover-wrap img{max-width:100%;max-height:100vh;height:auto;}
/* ---- Dark mode (color readers only; e-ink stays high-contrast B/W) ---- */
@media (prefers-color-scheme: dark){
  :root{--ink:#ececec;--paper:#121212;--muted:#bcbcbc;--rule:#444;}
}
`;

/* ----------------------------------------------------------------------------
 * XHTML page generators
 * ------------------------------------------------------------------------- */
/* `base` is the relative prefix from the document to the OEBPS root:
   '' for files at OEBPS root (cover.xhtml, nav.xhtml), '../' for text/*.xhtml. */
function xhtmlDoc({ lang, dir, title, bodyClass = '', body, base = '../' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8"/>
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" type="text/css" href="${base}css/style.css"/>
</head>
<body class="${bodyClass}" dir="${dir}">
${body}
</body>
</html>`;
}

function coverXhtml(ed, hasCoverImage) {
  const body = hasCoverImage
    ? `<section epub:type="cover" class="cover-wrap"><img src="images/cover.jpg" alt="${esc(ed.bookTitle)}"/></section>`
    : `<section epub:type="cover" class="cover-wrap page">
    <h1 class="surah-name-ar">${esc(ed.bookTitle)}</h1>
    <p class="surah-name-tr">${esc(ed.bookSubtitle)}</p></section>`;
  return xhtmlDoc({ lang: ed.language, dir: ed.pageDir, title: ed.bookTitle, body, base: '' });
}

function surahBanner(ch) {
  const translated = ch.translated_name && ch.translated_name.name ? ch.translated_name.name : ch.name_simple;
  return `  <header class="surah-banner">
    <div class="surah-name-ar">سُورَةُ ${esc(ch.name_arabic)}</div>
    <div class="surah-name-tr">${esc(ch.id)}. ${esc(ch.name_simple)} — ${esc(translated)}</div>
    <div class="surah-meta">${esc(ch.revelation_place === 'makkah' ? 'Makkiyyah' : 'Madaniyyah')} · ${toArabicNumerals(ch.verses_count)} آيات</div>
  </header>`;
}

/** Ornamental divider (PNG) shown under each surah header, when available. */
const dividerImg = (opts) => opts && opts.divider
  ? `  <img class="surah-divider" src="../images/divider.png" alt="" role="presentation"/>\n` : '';

/** Arabic-only surah file: ONE file per surah (device-friendly count, ~114),
 *  but internally split into MUSHAF-PAGE blocks (each `.page` = one official
 *  page: framed, numbered, and `break-before:page` so it starts a fresh screen).
 *  This gives the per-page look with a safe file count + smooth block pagination. */
function surahXhtmlArabic(ed, ch, verses, opts) {
  const showBismillah = ch.bismillah_pre && ch.id !== 9 && ch.id !== 1;
  // group consecutive verses by official mushaf page_number
  const groups = [];
  for (const v of verses) {
    const last = groups[groups.length - 1];
    if (!last || last.page !== v.page_number) groups.push({ page: v.page_number, items: [v] });
    else last.items.push(v);
  }
  const sections = groups.map((g, idx) => {
    const flow = g.items.map(v => {
      const t = (v[ed.arabicField] || '').trim();
      return `<span class="ayah" id="ayah-${ch.id}-${v.verse_number}">${esc(t)} <span class="ayah-num">${toArabicNumerals(v.verse_number)}</span> </span>`;
    }).join('');
    const header = idx === 0
      ? `${surahBanner(ch)}\n${showBismillah ? `    <p class="bismillah" dir="rtl" lang="ar">${esc(BISMILLAH)}</p>\n` : ''}${dividerImg(opts)}`
      : '';
    return `  <section class="page" epub:type="text" aria-label="Halaman ${g.page}">
${header}    <div class="quran-flow">${flow}</div>
    <p class="page-num">${toArabicNumerals(g.page)}</p>
  </section>`;
  }).join('\n');
  const body = `<div epub:type="chapter" id="surah-${ch.id}" role="doc-chapter" aria-label="${esc(ch.name_simple)}">
${sections}
</div>`;
  return xhtmlDoc({ lang: 'ar', dir: 'rtl', title: `${ch.id}. ${ch.name_simple}`, body });
}

/** Bilingual surah page: stacked verse cards (Arabic above, translation below). */
function surahXhtmlBilingual(ed, ch, verses, opts) {
  const showBismillah = ch.bismillah_pre && ch.id !== 9 && ch.id !== 1;
  const cards = verses.map(v => {
    const ar = (v[ed.arabicField] || '').trim();
    const tr = (v.translations && v.translations[0] && v.translations[0].text || '')
      .replace(/<sup[^>]*foot_note[^>]*>.*?<\/sup>/gi, '') // drop footnote markers
      .replace(/<[^>]+>/g, '').trim();
    return `  <div class="verse-card" id="ayah-${ch.id}-${v.verse_number}">
    <div class="quran-flow" dir="rtl" lang="ar">${esc(ar)} <span class="ayah-num">${toArabicNumerals(v.verse_number)}</span></div>
    <p class="translation"><span class="tnum">${ch.id}:${v.verse_number}</span>${esc(tr)}</p>
  </div>`;
  }).join('\n');
  const body = `<section epub:type="chapter" class="page" id="surah-${ch.id}" role="doc-chapter" aria-label="${esc(ch.name_simple)}">
${surahBanner(ch)}
${showBismillah ? `  <p class="bismillah" dir="rtl" lang="ar">${esc(BISMILLAH)}</p>` : ''}
${dividerImg(opts)}${cards}
</section>`;
  return xhtmlDoc({ lang: ed.language, dir: ed.pageDir, title: `${ch.id}. ${ch.name_simple}`, body });
}

/** One MUSHAF PAGE file: continuous flow of that page's verses, with a surah
 *  banner (+ bismillah + divider) inserted wherever a surah begins on the page.
 *  `items` = ordered [{ch, num, text}] on this page; `chById` = chapter lookup. */
function pageXhtml(ed, pageNo, items, chById, opts) {
  let html = '';
  let flow = [];
  const flush = () => { if (flow.length) { html += `  <div class="quran-flow">${flow.join('')}</div>\n`; flow = []; } };
  for (const it of items) {
    if (it.num === 1) {               // a surah starts here
      flush();
      const ch = chById.get(it.ch);
      html += surahBanner(ch) + '\n';
      const showBismillah = ch.bismillah_pre && ch.id !== 9 && ch.id !== 1;
      if (showBismillah) html += `  <p class="bismillah" dir="rtl" lang="ar">${esc(BISMILLAH)}</p>\n`;
      html += dividerImg(opts);
    }
    flow.push(`<span class="ayah" id="ayah-${it.ch}-${it.num}">${esc(it.text)} <span class="ayah-num">${toArabicNumerals(it.num)}</span> </span>`);
  }
  flush();
  const body = `<section epub:type="text" class="page" id="page-${pageNo}" aria-label="Halaman ${pageNo}">
${html}  <p class="page-num">${toArabicNumerals(pageNo)}</p>
</section>`;
  return xhtmlDoc({ lang: ed.language, dir: 'rtl', title: `Halaman ${pageNo}`, body });
}

/* ----------------------------------------------------------------------------
 * Navigation: EPUB3 nav.xhtml (toc + landmarks) and legacy toc.ncx
 * ------------------------------------------------------------------------- */

/** Build Juz → Surah tree. `hrefFor(ch, verse)` resolves a verse to its page file. */
function buildJuzTree(juzs, chapters, hrefFor) {
  const chById = new Map(chapters.map(c => [c.id, c]));
  return juzs.map(j => {
    const entries = Object.keys(j.verse_mapping)
      .map(k => parseInt(k, 10))
      .sort((a, b) => a - b)
      .map(cid => {
        const startVerse = parseInt(String(j.verse_mapping[cid]).split('-')[0], 10) || 1;
        const ch = chById.get(cid);
        return { chapterId: cid, startVerse, name: ch ? ch.name_simple : `Surah ${cid}`,
          nameAr: ch ? ch.name_arabic : '', href: hrefFor(cid, startVerse) };
      });
    const first = entries[0];
    return { juz: j.juz_number, anchorHref: first.href, entries };
  });
}

function navXhtml(ed, tree) {
  const juzItems = tree.map(j => {
    const sub = j.entries.map(e =>
      `          <li><a href="${e.href}">${e.chapterId}. ${esc(e.name)}</a></li>`
    ).join('\n');
    return `      <li class="toc-juz"><a href="${j.anchorHref}">Juz ${j.juz} — الجزء ${toArabicNumerals(j.juz)}</a>
        <ol>
${sub}
        </ol>
      </li>`;
  }).join('\n');

  const body = `  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>Daftar Isi / فهرس</h1>
    <ol>
${juzItems}
    </ol>
  </nav>

  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <h2>Landmarks</h2>
    <ol>
      <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
      <li><a epub:type="toc" href="nav.xhtml#toc">Table of Contents</a></li>
      <li><a epub:type="bodymatter" href="text/surah-001.xhtml">Begin Reading</a></li>
    </ol>
  </nav>`;
  return xhtmlDoc({ lang: ed.language, dir: ed.pageDir, title: 'Daftar Isi', bodyClass: 'nav', body, base: '' });
}

function ncxXml(ed, tree, uid) {
  let playOrder = 1;
  const navPoints = tree.map(j => {
    const children = j.entries.map(e => {
      const po = ++playOrder;
      return `      <navPoint id="np-${j.juz}-${e.chapterId}" playOrder="${po}">
        <navLabel><text>${e.chapterId}. ${esc(e.name)}</text></navLabel>
        <content src="${e.href}"/>
      </navPoint>`;
    }).join('\n');
    const po = playOrder - j.entries.length; // juz heading order (approx; monotonic overall)
    return `    <navPoint id="np-juz-${j.juz}" playOrder="${po || 1}">
      <navLabel><text>Juz ${j.juz} — الجزء ${toArabicNumerals(j.juz)}</text></navLabel>
      <content src="${j.anchorHref}"/>
${children}
    </navPoint>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${ed.language}">
  <head>
    <meta name="dtb:uid" content="${uid}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(ed.bookTitle)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

/* ----------------------------------------------------------------------------
 * content.opf
 * ------------------------------------------------------------------------- */
function contentOpf(ed, pageFiles, fontFile, hasCoverImage, imageList, uid, modified) {
  const manifest = [];
  const spine = [];

  manifest.push(`    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  manifest.push(`    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  manifest.push(`    <item id="css" href="css/style.css" media-type="text/css"/>`);

  if (hasCoverImage)
    manifest.push(`    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);

  const imageMime = (f) => {
    const e = f.toLowerCase().split('.').pop();
    return e === 'png' ? 'image/png' : e === 'svg' ? 'image/svg+xml'
      : (e === 'jpg' || e === 'jpeg') ? 'image/jpeg' : e === 'gif' ? 'image/gif' : 'application/octet-stream';
  };
  for (const img of imageList)
    manifest.push(`    <item id="img-${img.replace(/\W/g, '')}" href="images/${img}" media-type="${imageMime(img)}"/>`);

  if (fontFile)
    manifest.push(`    <item id="font-ar" href="fonts/${fontFile.file}" media-type="${fontMediaType(fontFile.file)}"/>`);

  manifest.push(`    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
  spine.push(`    <itemref idref="cover" linear="yes"/>`);
  spine.push(`    <itemref idref="nav" linear="yes"/>`);

  for (const id of pageFiles) {
    manifest.push(`    <item id="${id}" href="text/${id}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`    <itemref idref="${id}" linear="yes"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${ed.language}" dir="${ed.pageDir}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${uid}</dc:identifier>
    <dc:title>${esc(ed.bookTitle)}</dc:title>
    <dc:title id="subtitle">${esc(ed.bookSubtitle)}</dc:title>
    <dc:language>${ed.language}</dc:language>
    ${ed.bilingual ? '<dc:language>ar</dc:language>' : ''}
    <dc:creator>Al-Qur’an al-Karim</dc:creator>
    <dc:publisher>quran-epub-builder</dc:publisher>
    <dc:source>quran.com API v4</dc:source>
    <dc:rights>Quran text: public domain. Translation © Kementerian Agama RI (where applicable).</dc:rights>
    <meta property="dcterms:modified">${modified}</meta>
    <meta name="cover" content="cover-image"/>
    <meta property="rendition:layout">reflowable</meta>
    <meta property="ibooks:specified-fonts">true</meta>
  </metadata>
  <manifest>
${manifest.join('\n')}
  </manifest>
  <spine toc="ncx" page-progression-direction="${ed.pageDir}">
${spine.join('\n')}
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml"/>
    <reference type="toc" title="Daftar Isi" href="nav.xhtml"/>
    <reference type="text" title="Begin" href="text/surah-001.xhtml"/>
  </guide>
</package>`;
}

/* A deterministic UUID (no external dep) seeded by edition id. */
function uuidFor(seed) {
  // RFC-4122-ish v4 built from a simple hash of the seed (stable per edition).
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const rng = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return (h >>> 8) & 0xff; };
  const b = Array.from({ length: 16 }, rng);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/* ----------------------------------------------------------------------------
 * Build one edition
 * ------------------------------------------------------------------------- */
async function buildEdition(ed, shared) {
  console.log(`\n=== Building: ${ed.filename} ===`);
  const { juzs } = shared;
  const chapters = await fetchChapters(ed.chapterLang);

  // Resolve translation id for the Indonesian edition.
  if (ed.bilingual && ed.translationId) {
    ed.translationId = await resolveTranslationId(ed.translationId);
  }

  const font = await resolveFont(ed);
  if (font) console.log(`  ✓ embedding font: ${font.file}`);
  else console.log(`  ! no font embedded (system Arabic fallback will be used)`);

  const zip = new JSZip();

  // mimetype MUST be first and STORED (uncompressed).
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF
  zip.file('META-INF/container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package"/>
  </rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');

  // CSS
  oebps.file('css/style.css', buildCss(font));

  // E-INK SAFE: decoration is pure CSS. The only embedded raster besides the
  // cover is a single lightweight PNG divider (decoded once, reused per surah).
  const imageList = [];

  const coverPath = path.join(ASSETS_DIR, 'cover.jpg');
  const hasCoverImage = fs.existsSync(coverPath);
  if (hasCoverImage) oebps.file('images/cover.jpg', fs.readFileSync(coverPath));
  else console.log(`  ! assets/cover.jpg not found — using a generated text cover.`);

  // Optional ornamental divider (PNG). Shown under each surah header.
  const dividerPath = path.join(ASSETS_DIR, 'divider.png');
  const hasDivider = fs.existsSync(dividerPath);
  if (hasDivider) { oebps.file('images/divider.png', fs.readFileSync(dividerPath)); imageList.push('divider.png'); }
  else console.log(`  ! assets/divider.png not found — surah divider ornament skipped.`);

  // Font
  if (font) oebps.file(`fonts/${font.file}`, fs.readFileSync(font.path));

  // Cover page
  oebps.file('cover.xhtml', coverXhtml(ed, hasCoverImage));

  // One file per surah (safe, device-friendly count ~114). Each surah file is
  // internally split into framed mushaf-page blocks (see surahXhtmlArabic).
  // Verses are fetched WITH page_number so we can group them into pages.
  let pageCount = 0;
  const opts = { divider: hasDivider };
  process.stdout.write('  fetching surahs: ');
  for (const ch of chapters) {
    const verses = await fetchVerses(ch.id, { fields: `${ed.arabicField},page_number` });
    const pagesInSurah = new Set(verses.map(v => v.page_number)); pageCount += pagesInSurah.size;
    oebps.file(`text/surah-${pad3(ch.id)}.xhtml`, surahXhtmlArabic(ed, ch, verses, opts));
    process.stdout.write(ch.id % 10 === 0 ? `${ch.id} ` : '.');
  }
  console.log('done');
  const contentFiles = chapters.map(c => `surah-${pad3(c.id)}`);
  console.log(`  ✓ ${chapters.length} surah files (${pageCount} mushaf-page blocks inside)`);

  // Juz/Surah nav targets the surah file + first-ayah anchor of that portion.
  const hrefFor = (ch, num) => `text/surah-${pad3(ch)}.xhtml#ayah-${ch}-${num}`;

  // Navigation
  const tree = buildJuzTree(juzs, chapters, hrefFor);
  const uid = uuidFor(ed.id);
  oebps.file('nav.xhtml', navXhtml(ed, tree));
  oebps.file('toc.ncx', ncxXml(ed, tree, `urn:uuid:${uid}`));

  // OPF (last, after we know everything). Fixed modified date keeps builds reproducible.
  const modified = '2026-10-16T00:00:00Z';
  oebps.file('content.opf', contentOpf(ed, contentFiles, font, hasCoverImage, imageList, uid, modified));

  // Write .epub
  ensureDir(DIST);
  const out = path.join(DIST, ed.filename);
  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  fs.writeFileSync(out, buf);
  console.log(`  ✓ wrote ${path.relative(ROOT, out)} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);

  // Auto-validate every build. A file that fails validation is NOT considered done.
  process.stdout.write('  · validating … ');
  const { errors, warnings } = await validateEpubBuffer(buf);
  if (errors.length === 0) {
    console.log(`PASSED ✅  (0 errors${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
  } else {
    console.log(`FAILED ❌  (${errors.length} error(s))`);
    errors.slice(0, 20).forEach(e => console.log(`      - ${e}`));
  }
  if (warnings.length) warnings.slice(0, 10).forEach(w => console.log(`      ⚠ ${w}`));

  return { filename: ed.filename, sizeMB: (buf.length / 1024 / 1024).toFixed(2), errors: errors.length, warnings: warnings.length };
}

/* ----------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------- */
(async function main() {
  console.log('Quran EPUB Builder');
  console.log('API:', API, OFFLINE ? '(offline/cache mode)' : '');

  const juzs = await fetchJuzs();
  console.log(`Loaded ${juzs.length} juz (chapters fetched per-edition for correct name language).`);

  const shared = { juzs };
  const toBuild = ONLY ? [EDITIONS[ONLY]] : [EDITIONS.arab, EDITIONS.indopak];
  if (ONLY && !EDITIONS[ONLY]) { console.error(`Unknown --only=${ONLY}`); process.exit(1); }

  const results = [];
  for (const ed of toBuild) results.push(await buildEdition(ed, shared));

  // ---- Clear final summary ----
  const line = '─'.repeat(58);
  console.log(`\n┌${line}┐`);
  console.log(`│ BUILD SUMMARY${' '.repeat(44)}│`);
  console.log(`├${line}┤`);
  for (const r of results) {
    const status = r.errors === 0 ? 'PASS ✅' : 'FAIL ❌';
    const name = r.filename.length > 36 ? r.filename.slice(0, 35) + '…' : r.filename.padEnd(36);
    console.log(`│ ${status}  ${name} ${(r.sizeMB + ' MB').padStart(9)} │`);
  }
  console.log(`└${line}┘`);

  const failed = results.filter(r => r.errors > 0);
  if (failed.length) {
    console.error(`\n❌ ${failed.length} file(s) FAILED validation — see errors above. Not safe to upload.`);
    process.exit(1);
  }
  console.log(`\n✅ All ${results.length} file(s) built AND passed validation. Ready in ./dist — safe to upload to Send to Kindle.`);
})().catch(err => {
  console.error('\nBUILD FAILED:', err.stack || err.message);
  process.exit(1);
});
