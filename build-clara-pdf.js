'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const ROOT = __dirname;
const EPUB_PATH = path.join(ROOT, 'dist', 'Al-Quran', 'epub', 'Universal', 'Al-Quran.epub');
const COVER_PATH = path.join(ROOT, 'assets', 'Gemini_Generated_Image_tzoyi8tzoyi8tzoy.jpg');
const PDF_PATH = path.join(ROOT, 'dist', 'Al-Quran', 'pdf', 'Kobo-Clara', 'Al-Quran Kobo Clara.pdf');
const CLARA_WIDTH_MM = 90.76;
const CLARA_HEIGHT_MM = 122.61;

const PRINT_CSS = `
@page{size:${CLARA_WIDTH_MM}mm ${CLARA_HEIGHT_MM}mm;margin:0}
html,body{width:${CLARA_WIDTH_MM}mm;margin:0!important;padding:0!important;background:#f7f3e8!important;color:#455047!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
body{font-size:11.5px}
.cover-wrap{box-sizing:border-box;width:${CLARA_WIDTH_MM}mm;height:${CLARA_HEIGHT_MM}mm;min-height:0;margin:0;padding:0;display:block;overflow:hidden;page-break-after:always;break-after:page;background:#f7f3e8!important}
.cover-wrap img{display:block;width:100%;height:100%;max-width:none;max-height:none;object-fit:fill;object-position:center}
.page{box-sizing:border-box;width:${CLARA_WIDTH_MM}mm;height:${CLARA_HEIGHT_MM}mm;max-height:${CLARA_HEIGHT_MM}mm;margin:0!important;padding:2mm!important;border:.35mm double #879486!important;page-break-before:always;break-before:page;page-break-inside:avoid;break-inside:avoid;overflow:hidden}
.quran-flow{font-size:1.25em!important;line-height:1.65!important}
.surah-banner{margin:0 0 .3em!important;padding:.25em!important;border-width:1px!important}
.surah-name-ar{font-size:1.35em!important}
.surah-name-tr{font-size:.75em!important;margin-top:0!important}
.surah-meta{font-size:.6em!important;margin-top:0!important}
.bismillah{font-size:1.15em!important;margin:.2em 0 .3em!important}
.surah-divider{display:none!important}
.page-num{font-size:.75em!important;margin:.2em 0 0!important}
.ayah-num{font-size:.52em!important;margin:0 .15em!important;padding:.02em .22em!important}
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

function validatePdf(pdfPath, expectedPages) {
  const data = fs.readFileSync(pdfPath);
  const pdfText = data.toString('latin1');
  const pageCount = (pdfText.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const mediaBoxes = [...pdfText.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
    .map(match => match[1].trim().split(/\s+/).map(Number));
  const expectedWidth = CLARA_WIDTH_MM * 72 / 25.4;
  const expectedHeight = CLARA_HEIGHT_MM * 72 / 25.4;

  if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdfText.trimEnd().endsWith('%%EOF')) {
    throw new Error('Chrome did not produce a complete PDF.');
  }
  if (pageCount !== expectedPages) {
    throw new Error(`Expected ${expectedPages} full-page sheets, found ${pageCount} PDF pages.`);
  }
  if (mediaBoxes.length !== pageCount || mediaBoxes.some(box =>
    box.length !== 4 || Math.abs(box[0]) > 0.01 || Math.abs(box[1]) > 0.01 ||
    Math.abs(box[2] - expectedWidth) > 0.5 || Math.abs(box[3] - expectedHeight) > 0.5)) {
    throw new Error(`Not all PDF pages match the Kobo Clara size (${expectedWidth.toFixed(2)} x ${expectedHeight.toFixed(2)} pt).`);
  }
}

async function main() {
  if (!fs.existsSync(EPUB_PATH)) throw new Error(`EPUB not found: ${EPUB_PATH}`);
  if (!fs.existsSync(COVER_PATH)) throw new Error(`Cover image not found: ${COVER_PATH}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quran-clara-pdf-'));
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

    const coverBody = '<section epub:type="cover" class="cover-wrap"><img src="images/pdf-cover.jpg" alt="Al-Qur’an al-Karim"/></section>';
    const pageBodies = [];
    for (const filename of surahs) {
      const document = fs.readFileSync(path.join(textDir, filename), 'utf8');
      const body = extractBody(document, filename);
      pageBodies.push(body);
    }
    const mushafPages = pageBodies.reduce((sum, body) =>
      sum + (body.match(/class="page(?:\s|")/g) || []).length, 0);
    if (mushafPages === 0) throw new Error('No Mushaf page sections were found in the EPUB.');

    fs.copyFileSync(COVER_PATH, path.join(oebpsDir, 'images', 'pdf-cover.jpg'));
    const printable = `<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ar" dir="rtl">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Al-Qur’an al-Karim</title><link rel="stylesheet" href="css/style.css"/>
<style>${PRINT_CSS}</style></head>
<body>${coverBody}${pageBodies.join('')}</body></html>`;
    const printHtml = path.join(oebpsDir, 'print.html');
    fs.writeFileSync(printHtml, printable, 'utf8');

    const chrome = findChrome();
    const profileDir = path.join(tempDir, 'chrome-profile');
    fs.mkdirSync(path.dirname(PDF_PATH), { recursive: true });
    if (fs.existsSync(PDF_PATH)) fs.unlinkSync(PDF_PATH);
    const result = spawnSync(chrome, [
      '--headless',
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
    if (!fs.existsSync(PDF_PATH)) throw new Error('Chrome finished without creating the PDF.');

    validatePdf(PDF_PATH, mushafPages + 1);
    console.log(`Created ${path.relative(ROOT, PDF_PATH)} (${mushafPages + 1} full-page Clara sheets).`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`Failed to build Kobo Clara PDF: ${error.message}`);
  process.exitCode = 1;
});
