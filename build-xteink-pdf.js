'use strict';

/* =============================================================================
 * build-xteink-pdf.js — render Al-Quran.epub to a PDF sized 1:1 to an Xteink
 * device screen. Supports the X4 family and the X3 via device profiles.
 * -----------------------------------------------------------------------------
 *   node build-xteink-pdf.js x4      # -> dist/Al-Quran Xteink X4.pdf
 *   node build-xteink-pdf.js x3      # -> dist/Al-Quran Xteink X3.pdf
 *   node build-xteink-pdf.js all     # both (default)
 *
 * Why per-device: each page = exactly one device screen (margin 0), so the
 * mushaf fills the screen 1:1 with no letterboxing. Content flows CONTINUOUSLY
 * (no fixed per-page boxes, no forced breaks) so verses paginate naturally to
 * fill each small screen instead of being clipped. Chrome bakes the Arabic
 * shaping (joining + harakat) into the PDF, so it renders correctly even though
 * the X3/X4 firmware ignores EPUB @font-face and only uses .bin device fonts.
 *
 * Shared by preview-xteink.js (it requires DEVICES + printCss from here), so
 * the preview always matches the real PDF.
 *
 * NOTE on X3 resolution: Xteink has not published it officially. 528x792 @ 259
 * PPI best fits the 3.7" panel; if your unit reports otherwise (Settings >
 * About), edit DEVICES.x3.resPx below and rebuild.
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const ROOT = __dirname;
const EPUB_PATH = path.join(ROOT, 'dist', 'Al-Quran', 'epub', 'Universal', 'Al-Quran.epub');
const COVER_PATH = path.join(ROOT, 'assets', 'alquran_karim_text_cover.jpg');
const MM_PER_IN = 25.4;

// Quran font baked into the PDF, overriding the EPUB's embedded @font-face.
// LPMQ Isep Misbah (Kemenag Mushaf Standar Indonesia) renders the iqlab/tajwid
// marks cleanly; KFGQPC shows the small meem as a dark blob on e-ink. To switch,
// point this at another TTF/OTF in assets/fonts/ (e.g. AmiriQuran-Regular.ttf,
// format 'truetype'; or UthmanicHafs.otf, format 'opentype').
const QURAN_FONT = {
  file: 'LPMQ-IsepMisbah.ttf',
  src: path.join(ROOT, 'assets', 'fonts', 'LPMQ-IsepMisbah.ttf'),
  fmt: 'truetype',
};

// Page numbers run to 604 (3 digits). LPMQ only has its ayah-end ornament glyph
// for numbers up to ~286, so bigger page numbers split into two ornaments; and
// its plain digits are tiny with a near-invisible zero-dot. Scheherazade New
// renders clear, well-sized Arabic-Indic digits (no ornament), so we bake it
// just for the page number.
const PAGENUM_FONT = {
  file: 'ScheherazadeNew-Regular.ttf',
  src: path.join(ROOT, 'assets', 'fonts', 'ScheherazadeNew-Regular.ttf'),
  fmt: 'truetype',
};

// --- Device profiles ---------------------------------------------------------
// resPx: [width, height] in portrait. ppi: panel density. type: CSS sizes tuned
// so Arabic stays comfortable at that physical screen size.
const DEVICES = {
  x4: {
    label: 'Xteink X4 / X4 V2 (Classic) / X4 Pro',
    out: 'Al-Quran Xteink X4.pdf',
    dir: path.join('Al-Quran', 'pdf', 'Xteink-X4'),
    resPx: [480, 800],
    ppi: 220,                 // X4 family: 219–220 PPI
    type: {
      marginMm: 2.2,
      arabicPx: 17.5,
      arabicLineHeight: 2.0,
      surahNameArPx: 23,
      bismillahPx: 18,
      ayahNumEm: 0.9,
      pageNumPx: 16,
    },
  },
  x3: {
    label: 'Xteink X3',
    out: 'Al-Quran Xteink X3.pdf',
    dir: path.join('Al-Quran', 'pdf', 'Xteink-X3'),
    resPx: [528, 792],        // best fit for 3.7" @ 259 PPI (not officially published)
    ppi: 259,
    type: {
      marginMm: 2.0,
      arabicPx: 16,           // page is narrower than X4 → slightly smaller keeps words/line similar
      arabicLineHeight: 1.95,
      surahNameArPx: 21,
      bismillahPx: 16.5,
      ayahNumEm: 0.9,
      pageNumPx: 15,
    },
  },
};

function geometry(dev) {
  const [wpx, hpx] = dev.resPx;
  return {
    wpx, hpx, ppi: dev.ppi,
    widthMm: (wpx / dev.ppi) * MM_PER_IN,
    heightMm: (hpx / dev.ppi) * MM_PER_IN,
  };
}

// Print CSS for a device. Exported so the preview can reuse the exact rules.
function printCss(dev) {
  const g = geometry(dev);
  const t = dev.type;
  return `
@font-face{font-family:'QuranArabic';font-style:normal;font-weight:400;src:url('fonts/${QURAN_FONT.file}') format('${QURAN_FONT.fmt}');}
@font-face{font-family:'PageNumFont';font-style:normal;font-weight:400;src:url('fonts/${PAGENUM_FONT.file}') format('${PAGENUM_FONT.fmt}');}
@page{size:${g.widthMm}mm ${g.heightMm}mm;margin:0}
html,body{width:${g.widthMm}mm;margin:0!important;padding:0!important;background:#ffffff!important;color:#000000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{box-sizing:border-box;padding:${t.marginMm}mm!important;font-size:${t.arabicPx}px}

/* Cover: one full device screen, then break. Negative margins cancel the body
   padding so the image is full-bleed AND still fits exactly one page — otherwise
   the body padding pushes the full-height cover onto a 2nd sheet (blank page 1). */
.cover-wrap{box-sizing:border-box;width:${g.widthMm}mm;height:${g.heightMm}mm;min-height:0;margin:-${t.marginMm}mm -${t.marginMm}mm 0;padding:0;display:block;overflow:hidden;page-break-after:always;break-after:page;background:#ffffff!important}
.cover-wrap img{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:fill;object-position:center}

/* CONTINUOUS FLOW: no fixed page box, no forced breaks, no clipping. */
.page{border:0!important;padding:0!important;margin:0!important;page-break-before:auto!important;break-before:auto!important;overflow:visible!important}

/* text-align:right (NOT justify). Chrome justifies Arabic with kashida — it
   stretches the cursive joins between letters, which at this small font size
   SNAPS the join (e.g. بِهِمْ renders as "بِ هِمْ"). Right-align keeps every
   join intact and also removes the over-wide inter-word gaps justify produced. */
.quran-flow{font-size:1em!important;line-height:${t.arabicLineHeight}!important;text-align:right!important;font-weight:bold}
.surah-name-ar,.bismillah,.ayah-num{font-weight:bold}
.surah-banner{margin:.5em 0 .4em!important;padding:.3em .25em!important;border-width:1px!important;break-inside:avoid}
.surah-name-ar{font-size:${t.surahNameArPx}px!important;line-height:1.3!important}
.surah-name-tr{font-size:.72em!important;margin-top:.05em!important}
.surah-meta{font-size:.6em!important;margin-top:.05em!important}
.bismillah{font-size:${t.bismillahPx}px!important;margin:.25em 0 .35em!important}
.surah-divider{display:none!important}
/* Plain digits, NOT the font's ayah-end ornament. LPMQ only has the ornament
   ligature for numbers up to ~286 (max ayah count); page numbers run to 604, so
   e.g. ٦٠٤ splits into TWO ornaments (٦٠ + ٤). Disabling the ligatures renders
   the page number as plain digits in a single slot. Bigger px compensates for
   the ornament's lost size. */
.page-num{font-family:'PageNumFont',serif!important;font-size:${t.pageNumPx}px!important;margin:.2em 0 .6em!important;color:#000!important;font-weight:bold!important}
.ayah-num{font-size:${t.ayahNumEm}em!important;margin:0 .2em!important;padding:0!important;min-width:0!important;border:0!important;background:none!important;border-radius:0!important;color:#000!important;white-space:nowrap!important}
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
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  if (process.platform === 'win32') {
    for (const exe of ['chrome.exe', 'msedge.exe']) {
      try {
        const found = execFileSync('where.exe', [exe], { encoding: 'utf8' })
          .split(/\r?\n/).map(s => s.trim()).find(Boolean);
        if (found) return found;
      } catch {}
    }
  }
  throw new Error('Chrome or Microsoft Edge was not found. Set CHROME_PATH to its executable.');
}

function safeOebpsPath(oebpsDir, entryName) {
  const relativeName = entryName.slice('OEBPS/'.length);
  const fullPath = path.resolve(oebpsDir, ...relativeName.split('/'));
  if (!fullPath.startsWith(oebpsDir + path.sep)) {
    throw new Error(`Unsafe path in EPUB archive: ${entryName}`);
  }
  return fullPath;
}

// Drop the literal spaces hugging each ayah-number span. With text-align:justify
// those U+0020 spaces STRETCH like any inter-word gap, so the number floats far
// from its verse. Removing them lets the .ayah-num CSS margin (fixed, .Nem) set a
// tight, non-stretching gap instead. Pattern baked by builder.js is:
//   <text> <span class="ayah-num">N</span> </span>
function tightenAyahNumbers(html) {
  return html
    .replace(/ (<span class="ayah-num">)/g, '$1')              // space BEFORE the number
    .replace(/(<span class="ayah-num">[^<]*<\/span>) /g, '$1'); // space AFTER the number
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Decode the handful of HTML entities that appear in <title> (e.g. "Ali &#39;Imran")
// so the PDF bookmark — which is plain text, not markup — shows a real apostrophe.
const decodeEntities = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Add a PDF outline (bookmarks) via add-pdf-outline.py (PyMuPDF). Chrome's
// print-to-pdf emits named destinations for our #pdfnav-N anchors but no
// document outline; the official Xteink converter builds the .xtcz chapter list
// from the outline. Flat list (one level-1 bookmark per surah). Non-fatal.
function addPdfOutline(pdfPath, items, tempDir) {
  if (!items.length) return true;
  const jsonPath = path.join(tempDir, 'outline.json');
  const flat = items.map(it => ({ level: 1, title: it.title, name: it.name }));
  fs.writeFileSync(jsonPath, JSON.stringify(flat), 'utf8');
  const script = path.join(ROOT, 'add-pdf-outline.py');
  let lastErr = '';
  for (const py of [process.env.PYTHON, 'python', 'py'].filter(Boolean)) {
    const r = spawnSync(py, [script, pdfPath, jsonPath], { encoding: 'utf8' });
    if (!r.error && r.status === 0) {
      console.log(`  + outline: ${(r.stdout || '').trim() || `${flat.length} bookmarks`}`);
      return true;
    }
    lastErr = (r.error && r.error.message) || r.stderr || r.stdout || '';
  }
  console.warn(`  ! outline skipped (need Python + PyMuPDF): ${lastErr.trim().split('\n').pop()}`);
  return false;
}

function extractBody(xhtml, filename) {
  const match = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error(`No body found in ${filename}`);
  return tightenAyahNumbers(match[1]);
}

function validatePdf(pdfPath, dev) {
  const g = geometry(dev);
  const data = fs.readFileSync(pdfPath);
  const pdfText = data.toString('latin1');
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const mediaBoxes = [...pdfText.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
    .map(match => match[1].trim().split(/\s+/).map(Number));
  const expectedWidth = g.widthMm * 72 / MM_PER_IN;
  const expectedHeight = g.heightMm * 72 / MM_PER_IN;

  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdfText.trimEnd().endsWith('%%EOF')) {
    throw new Error('Chrome did not produce a complete PDF.');
  }
  if (pageCount < 1) throw new Error('PDF has no pages.');
  if (mediaBoxes.length !== pageCount || mediaBoxes.some(box =>
    box.length !== 4 || Math.abs(box[0]) > 0.01 || Math.abs(box[1]) > 0.01 ||
    Math.abs(box[2] - expectedWidth) > 0.5 || Math.abs(box[3] - expectedHeight) > 0.5)) {
    throw new Error(`Not all PDF pages match the ${dev.label} size (${expectedWidth.toFixed(2)} x ${expectedHeight.toFixed(2)} pt).`);
  }
  return pageCount;
}

async function buildOne(key) {
  const dev = DEVICES[key];
  if (!dev) throw new Error(`Unknown device "${key}". Use: ${Object.keys(DEVICES).join(', ')}, all.`);
  if (!fs.existsSync(EPUB_PATH)) throw new Error(`EPUB not found: ${EPUB_PATH}`);
  const g = geometry(dev);
  const pdfPath = path.join(ROOT, 'dist', dev.dir, dev.out);
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `quran-${key}-pdf-`));
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(EPUB_PATH));
    const oebpsDir = path.join(tempDir, 'OEBPS');
    fs.mkdirSync(oebpsDir, { recursive: true });

    for (const [entryName, entry] of Object.entries(zip.files)) {
      if (entry.dir || !entryName.startsWith('OEBPS/')) continue;
      const target = safeOebpsPath(oebpsDir, entryName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await entry.async('nodebuffer'));
    }

    // Bake the chosen Quran font in (printCss re-points 'QuranArabic' to it).
    if (!fs.existsSync(QURAN_FONT.src)) throw new Error(`Quran font not found: ${QURAN_FONT.src}`);
    if (!fs.existsSync(PAGENUM_FONT.src)) throw new Error(`Page-number font not found: ${PAGENUM_FONT.src}`);
    fs.mkdirSync(path.join(oebpsDir, 'fonts'), { recursive: true });
    fs.copyFileSync(QURAN_FONT.src, path.join(oebpsDir, 'fonts', QURAN_FONT.file));
    fs.copyFileSync(PAGENUM_FONT.src, path.join(oebpsDir, 'fonts', PAGENUM_FONT.file));

    const textDir = path.join(oebpsDir, 'text');
    const surahs = fs.readdirSync(textDir)
      .filter(name => /^surah-\d{3}\.xhtml$/.test(name)).sort();
    if (surahs.length !== 114) {
      throw new Error(`Expected 114 surah XHTML files, found ${surahs.length}.`);
    }

    let coverBody = '';
    const epubCover = path.join(oebpsDir, 'images', 'cover.jpg');
    if (fs.existsSync(COVER_PATH)) {
      fs.copyFileSync(COVER_PATH, path.join(oebpsDir, 'images', 'pdf-cover.jpg'));
      coverBody = '<section epub:type="cover" class="cover-wrap"><img src="images/pdf-cover.jpg" alt="Al-Qur’an al-Karim"/></section>';
    } else if (fs.existsSync(epubCover)) {
      coverBody = '<section epub:type="cover" class="cover-wrap"><img src="images/cover.jpg" alt="Al-Qur’an al-Karim"/></section>';
    }

    // One wrapped section per surah with a stable id, plus its bookmark title.
    // The hidden <nav> links make Chrome emit a named destination per id; the
    // official Xteink converter builds the .xtcz chapter list from the outline
    // we attach afterwards (Chrome's print-to-pdf emits no outline itself).
    const outlineItems = [];
    const pageBodies = surahs.map(f => {
      const xhtml = fs.readFileSync(path.join(textDir, f), 'utf8');
      const num = parseInt(f.match(/surah-(\d{3})\.xhtml$/)[1], 10);
      const title = decodeEntities(((xhtml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || `Surah ${num}`).trim());
      const anchor = `pdfnav-${num}`;
      outlineItems.push({ name: anchor, title });
      return `<section id="${anchor}">${extractBody(xhtml, f)}</section>`;
    });
    const navLinks = `<nav style="display:none">${
      outlineItems.map(it => `<a href="#${it.name}">${esc(it.title)}</a>`).join('')}</nav>`;

    const printable = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ar" dir="rtl">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Al-Qur’an al-Karim — ${dev.label}</title><link rel="stylesheet" href="css/style.css"/>
<style>${printCss(dev)}</style></head>
<body>${coverBody}${navLinks}${pageBodies.join('')}</body></html>`;
    const printHtml = path.join(oebpsDir, 'print.html');
    fs.writeFileSync(printHtml, printable, 'utf8');

    const chrome = findChrome();
    const profileDir = path.join(tempDir, 'chrome-profile');
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    const result = spawnSync(chrome, [
      '--headless', '--disable-gpu', '--no-sandbox', '--disable-extensions',
      '--no-pdf-header-footer',
      `--user-data-dir=${profileDir}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(printHtml).href
    ], { encoding: 'utf8', timeout: 180000 });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`PDF rendering failed: ${(result.stderr || result.stdout || '').trim()}`);
    }
    if (!fs.existsSync(pdfPath)) throw new Error('Chrome finished without creating the PDF.');

    const pages = validatePdf(pdfPath, dev);

    // Attach a flat 114-surah outline so the official converter can build the
    // .xtcz chapter list (without it the chapter list is empty).
    addPdfOutline(pdfPath, outlineItems, tempDir);

    const sizeMb = (fs.statSync(pdfPath).size / (1024 * 1024)).toFixed(2);
    console.log(`✓ ${dev.out} — ${pages} sheets, ${sizeMb} MB · ` +
      `${g.widthMm.toFixed(2)}x${g.heightMm.toFixed(2)} mm = ${g.wpx}x${g.hpx} px @ ${g.ppi} PPI`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const arg = (process.argv[2] || 'all').toLowerCase();
  const keys = arg === 'all' ? Object.keys(DEVICES) : [arg];
  for (const key of keys) await buildOne(key);
}

module.exports = { DEVICES, geometry, printCss, QURAN_FONT };

if (require.main === module) {
  main().catch(error => {
    console.error(`Failed to build Xteink PDF: ${error.message}`);
    process.exitCode = 1;
  });
}
