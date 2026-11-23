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
const EPUB_PATH = path.join(ROOT, 'dist', 'Al-Quran.epub');
const COVER_PATH = path.join(ROOT, 'assets', 'Gemini_Generated_Image_tzoyi8tzoyi8tzoy.jpg');
const MM_PER_IN = 25.4;

// --- Device profiles ---------------------------------------------------------
// resPx: [width, height] in portrait. ppi: panel density. type: CSS sizes tuned
// so Arabic stays comfortable at that physical screen size.
const DEVICES = {
  x4: {
    label: 'Xteink X4 / X4 V2 (Classic) / X4 Pro',
    out: 'Al-Quran Xteink X4.pdf',
    resPx: [480, 800],
    ppi: 220,                 // X4 family: 219–220 PPI
    type: {
      marginMm: 2.2,
      arabicPx: 17.5,
      arabicLineHeight: 2.0,
      surahNameArPx: 23,
      bismillahPx: 18,
      ayahNumEm: 0.9,
      pageNumPx: 9,
    },
  },
  x3: {
    label: 'Xteink X3',
    out: 'Al-Quran Xteink X3.pdf',
    resPx: [528, 792],        // best fit for 3.7" @ 259 PPI (not officially published)
    ppi: 259,
    type: {
      marginMm: 2.0,
      arabicPx: 16,           // page is narrower than X4 → slightly smaller keeps words/line similar
      arabicLineHeight: 1.95,
      surahNameArPx: 21,
      bismillahPx: 16.5,
      ayahNumEm: 0.9,
      pageNumPx: 8.5,
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
@page{size:${g.widthMm}mm ${g.heightMm}mm;margin:0}
html,body{width:${g.widthMm}mm;margin:0!important;padding:0!important;background:#ffffff!important;color:#000000!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{box-sizing:border-box;padding:${t.marginMm}mm!important;font-size:${t.arabicPx}px}

/* Cover: one full device screen, then break */
.cover-wrap{box-sizing:border-box;width:${g.widthMm}mm;height:${g.heightMm}mm;min-height:0;margin:0;padding:0;display:block;overflow:hidden;page-break-after:always;break-after:page;background:#ffffff!important}
.cover-wrap img{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:fill;object-position:center}

/* CONTINUOUS FLOW: no fixed page box, no forced breaks, no clipping. */
.page{border:0!important;padding:0!important;margin:0!important;page-break-before:auto!important;break-before:auto!important;overflow:visible!important}

.quran-flow{font-size:1em!important;line-height:${t.arabicLineHeight}!important;text-align:justify;text-align-last:right}
.surah-banner{margin:.5em 0 .4em!important;padding:.3em .25em!important;border-width:1px!important;break-inside:avoid}
.surah-name-ar{font-size:${t.surahNameArPx}px!important;line-height:1.3!important}
.surah-name-tr{font-size:.72em!important;margin-top:.05em!important}
.surah-meta{font-size:.6em!important;margin-top:.05em!important}
.bismillah{font-size:${t.bismillahPx}px!important;margin:.25em 0 .35em!important}
.surah-divider{display:none!important}
.page-num{font-size:${t.pageNumPx}px!important;margin:.2em 0 .6em!important}
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

function extractBody(xhtml, filename) {
  const match = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error(`No body found in ${filename}`);
  return match[1];
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
  const pdfPath = path.join(ROOT, 'dist', dev.out);

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

    const pageBodies = surahs.map(f =>
      extractBody(fs.readFileSync(path.join(textDir, f), 'utf8'), f));

    const printable = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ar" dir="rtl">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Al-Qur’an al-Karim — ${dev.label}</title><link rel="stylesheet" href="css/style.css"/>
<style>${printCss(dev)}</style></head>
<body>${coverBody}${pageBodies.join('')}</body></html>`;
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

module.exports = { DEVICES, geometry, printCss };

if (require.main === module) {
  main().catch(error => {
    console.error(`Failed to build Xteink PDF: ${error.message}`);
    process.exitCode = 1;
  });
}
