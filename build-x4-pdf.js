'use strict';

/* =============================================================================
 * build-x4-pdf.js — render Al-Quran.epub to a PDF sized 1:1 to the Xteink X4.
 * -----------------------------------------------------------------------------
 * The Xteink X4 is a 4.3" / 800x480 / 220 PPI e-ink reader on an ESP32 MCU.
 * Its firmware does NOT honour EPUB @font-face fonts and only renders device
 * fonts converted to Xteink's proprietary .bin format. A PDF sidesteps that:
 * Chrome bakes the Arabic shaping (joining + harakat) into the page, so the
 * text renders correctly regardless of the device font.
 *
 * Page = exactly one X4 screen (55.425mm x 92.364mm = 480x800 px @ 220 PPI),
 * margin 0. Content flows CONTINUOUSLY (no fixed per-mushaf-page boxes, no
 * forced breaks) so verses paginate naturally to fill each small screen
 * instead of being clipped. Tune the sizes in X4 below.
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const ROOT = __dirname;
// Source EPUB and output PDF are overridable so the same layout can render a
// different edition (e.g. Kemenag). Defaults keep the original Uthmani build.
const EPUB_PATH = process.env.X4_SRC_EPUB
  ? path.resolve(ROOT, process.env.X4_SRC_EPUB)
  : path.join(ROOT, 'dist', 'Al-Quran.epub');
const COVER_PATH = path.join(ROOT, 'assets', 'Gemini_Generated_Image_tzoyi8tzoyi8tzoy.jpg');
const PDF_PATH = process.env.X4_OUT_PDF
  ? path.resolve(ROOT, process.env.X4_OUT_PDF)
  : path.join(ROOT, 'dist', 'Al-Quran Xteink X4.pdf');

// --- Xteink X4 screen geometry: 480 x 800 px @ 220 PPI -----------------------
const X4_PPI = 220;
const X4_W_PX = 480;
const X4_H_PX = 800;
const MM_PER_IN = 25.4;
const X4_WIDTH_MM = (X4_W_PX / X4_PPI) * MM_PER_IN;   // 55.4255 mm
const X4_HEIGHT_MM = (X4_H_PX / X4_PPI) * MM_PER_IN;  // 92.3636 mm

// --- Tunables (bump these if you want bigger Arabic on the X4) ----------------
const X4 = {
  marginMm: 2.4,          // inner page margin all round
  arabicPx: 15,           // base Arabic flow size (continuous mushaf flow)
  arabicLineHeight: 1.95, // Arabic line spacing
  surahNameArPx: 20,      // surah title (Arabic)
  bismillahPx: 16,
  ayahNumEm: 0.62,        // ayah-end medallion relative to flow
  pageNumPx: 8.5,
};

const PRINT_CSS = `
@page{size:${X4_WIDTH_MM}mm ${X4_HEIGHT_MM}mm;margin:0}
html,body{width:${X4_WIDTH_MM}mm;margin:0!important;padding:0!important;background:#ffffff!important;color:#000000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{box-sizing:border-box;padding:${X4.marginMm}mm!important;font-size:${X4.arabicPx}px}

/* Cover: one full X4 screen, then break. The negative margin cancels the body
   padding so the cover is full-bleed; WITHOUT it the full-height cover-wrap
   overflows past the page edge and Chrome prints a BLANK first page. */
.cover-wrap{box-sizing:border-box;width:${X4_WIDTH_MM}mm;height:${X4_HEIGHT_MM}mm;min-height:0;margin:-${X4.marginMm}mm -${X4.marginMm}mm 0;padding:0;display:block;overflow:hidden;page-break-after:always;break-after:page;background:#ffffff!important}
.cover-wrap img{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:fill;object-position:center}

/* CONTINUOUS FLOW: no fixed page box, no forced breaks, no clipping.
   Let the content paginate naturally across X4-sized sheets. */
.page{border:0!important;padding:0!important;margin:0!important;page-break-before:auto!important;break-before:auto!important;overflow:visible!important}

/* Bolder Arabic for e-ink legibility via faux-bold (font-weight:700). NB: avoid
   -webkit-text-stroke here — it balloons the PDF into per-glyph vector outlines
   and OOMs the rasteriser. */
.quran-flow{font-size:1em!important;line-height:${X4.arabicLineHeight}!important;text-align:justify;text-align-last:right;font-weight:700!important}
.surah-banner{margin:.5em 0 .4em!important;padding:.3em .25em!important;border-width:1px!important;break-inside:avoid}
.surah-name-ar{font-size:${X4.surahNameArPx}px!important;line-height:1.3!important;font-weight:700!important}
.surah-name-tr{font-size:.72em!important;margin-top:.05em!important}
.surah-meta{font-size:.6em!important;margin-top:.05em!important}
.bismillah{font-size:${X4.bismillahPx}px!important;margin:.25em 0 .35em!important;font-weight:700!important}
.surah-divider{display:none!important}
.page-num{font-size:${X4.pageNumPx}px!important;margin:.2em 0 .6em!important}
/* Ayah marker: drop the decorative cream/green motif; plain SOLID BLACK ring
   with a black bold number — high contrast on e-ink. */
.ayah-num{font-size:${X4.ayahNumEm}em!important;margin:0 .15em!important;padding:.02em .22em!important;background:#fff!important;border:1.6px solid #000!important;border-color:#000!important;color:#000!important;font-weight:700!important}
`;

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

function safeOebpsPath(oebpsDir, entryName) {
  const relativeName = entryName.slice('OEBPS/'.length);
  const fullPath = path.resolve(oebpsDir, ...relativeName.split('/'));
  if (!fullPath.startsWith(oebpsDir + path.sep)) {
    throw new Error(`Unsafe path in EPUB archive: ${entryName}`);
  }
  return fullPath;
}

function extractBody(xhtml, filename) {
  const match = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error(`No body found in ${filename}`);
  return match[1];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Wait until the PDF exists AND is fully written (ends with %%EOF) and its size
// has stopped growing. Guards against the chrome.exe launcher-detach race on
// Windows where spawnSync returns before the renderer has flushed the file.
async function waitForCompletePdf(pdfPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  while (Date.now() < deadline) {
    if (fs.existsSync(pdfPath)) {
      const size = fs.statSync(pdfPath).size;
      if (size > 0 && size === lastSize) {
        const tail = fs.readFileSync(pdfPath).subarray(-8).toString('latin1');
        if (tail.includes('%%EOF')) return;
      }
      lastSize = size;
    }
    await sleep(400);
  }
  throw new Error('Chrome finished without creating a complete PDF (timed out waiting).');
}

function validatePdf(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  const pdfText = data.toString('latin1');
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const mediaBoxes = [...pdfText.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
    .map(match => match[1].trim().split(/\s+/).map(Number));
  const expectedWidth = X4_WIDTH_MM * 72 / MM_PER_IN;
  const expectedHeight = X4_HEIGHT_MM * 72 / MM_PER_IN;

  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdfText.trimEnd().endsWith('%%EOF')) {
    throw new Error('Chrome did not produce a complete PDF.');
  }
  if (pageCount < 1) throw new Error('PDF has no pages.');
  if (mediaBoxes.length !== pageCount || mediaBoxes.some(box =>
    box.length !== 4 || Math.abs(box[0]) > 0.01 || Math.abs(box[1]) > 0.01 ||
    Math.abs(box[2] - expectedWidth) > 0.5 || Math.abs(box[3] - expectedHeight) > 0.5)) {
    throw new Error(`Not all PDF pages match the Xteink X4 size (${expectedWidth.toFixed(2)} x ${expectedHeight.toFixed(2)} pt).`);
  }
  return pageCount;
}

async function main() {
  if (!fs.existsSync(EPUB_PATH)) throw new Error(`EPUB not found: ${EPUB_PATH}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-x4-pdf-'));
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

    const textDir = path.join(oebpsDir, 'text');
    const surahs = fs.readdirSync(textDir)
      .filter(name => /^surah-\d{3}\.xhtml$/.test(name))
      .sort();
    if (surahs.length !== 114) {
      throw new Error(`Expected 114 surah XHTML files in ${EPUB_PATH}, found ${surahs.length}.`);
    }

    // Optional cover: a full first X4 screen. Falls back to the EPUB cover image.
    let coverBody = '';
    const epubCover = path.join(oebpsDir, 'images', 'cover.jpg');
    if (fs.existsSync(COVER_PATH)) {
      fs.copyFileSync(COVER_PATH, path.join(oebpsDir, 'images', 'pdf-cover.jpg'));
      coverBody = '<section epub:type="cover" class="cover-wrap"><img src="images/pdf-cover.jpg" alt="Al-Qur’an al-Karim"/></section>';
    } else if (fs.existsSync(epubCover)) {
      coverBody = '<section epub:type="cover" class="cover-wrap"><img src="images/cover.jpg" alt="Al-Qur’an al-Karim"/></section>';
    }

    const pageBodies = [];
    for (const filename of surahs) {
      const document = fs.readFileSync(path.join(textDir, filename), 'utf8');
      pageBodies.push(extractBody(document, filename));
    }

    const printable = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ar" dir="rtl">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Al-Qur’an al-Karim — Xteink X4</title><link rel="stylesheet" href="css/style.css"/>
<style>${PRINT_CSS}</style></head>
<body>${coverBody}${pageBodies.join('')}</body></html>`;
    const printHtml = path.join(oebpsDir, 'print.html');
    fs.writeFileSync(printHtml, printable, 'utf8');

    const chrome = findChrome();
    const profileDir = path.join(tempDir, 'chrome-profile');
    if (fs.existsSync(PDF_PATH)) fs.unlinkSync(PDF_PATH);
    const result = spawnSync(chrome, [
      // Chrome 132+ removed the legacy headless; --headless=new is required or
      // Chrome exits 0 without writing the PDF. Edge still accepts this form.
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-extensions',
      '--no-pdf-header-footer',
      `--user-data-dir=${profileDir}`,
      `--print-to-pdf=${PDF_PATH}`,
      pathToFileURL(printHtml).href
    ], { encoding: 'utf8', timeout: 180000 });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`PDF rendering failed: ${(result.stderr || result.stdout || '').trim()}`);
    }
    // On Windows, chrome.exe is a thin launcher that relaunches itself as a
    // detached child: spawnSync returns 0 *before* the real renderer finishes
    // writing the PDF (the file shows up a few seconds later). Poll for a
    // complete PDF (ends with %%EOF) instead of checking once immediately.
    await waitForCompletePdf(PDF_PATH, 120000);

    const pages = validatePdf(PDF_PATH);
    const sizeMb = (fs.statSync(PDF_PATH).size / (1024 * 1024)).toFixed(2);
    console.log(`Created ${path.relative(ROOT, PDF_PATH)} (${pages} Xteink X4 sheets, ${sizeMb} MB).`);
    console.log(`Page size: ${X4_WIDTH_MM.toFixed(2)} x ${X4_HEIGHT_MM.toFixed(2)} mm = ${X4_W_PX}x${X4_H_PX} px @ ${X4_PPI} PPI.`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`Failed to build Xteink X4 PDF: ${error.message}`);
  process.exitCode = 1;
});
