'use strict';

/* =============================================================================
 * preview-x4.js — render X4-sized "sheets" to a PNG for quick visual QA.
 * -----------------------------------------------------------------------------
 * Renders chosen surahs as fixed Xteink X4 pages (480x800 px @ 220 PPI,
 * 55.4255 x 92.3636 mm) clipped exactly like one device screen, using the SAME
 * PRINT_CSS as build-x4-pdf.js — so this previews what the real PDF produces.
 *
 *   node preview-x4.js                 # default set (Baqarah, Kahf, Rahman, Mulk)
 *   node preview-x4.js 1 36 112        # pick surah numbers
 *   node preview-x4.js --out my.png 55 # custom output path
 *
 * Output (default): dist/x4-preview.png   Needs Chrome or Microsoft Edge.
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');

const ROOT = __dirname;
const EPUB_PATH = path.join(ROOT, 'dist', 'Al-Quran.epub');

// X4 page geometry in CSS px (96 px/in). 55.4255mm x 92.3636mm = 480x800 @ 220PPI.
const MM_PER_IN = 25.4;
const PAGE_W_PX = (55.4255 / MM_PER_IN) * 96;   // ~209.45
const PAGE_H_PX = (92.3636 / MM_PER_IN) * 96;   // ~349.10
const PAD_PX = (2.2 / MM_PER_IN) * 96;          // keep in sync with build-x4-pdf.js X4.marginMm

function parseArgs(argv) {
  const surahs = [];
  let out = path.join(ROOT, 'dist', 'x4-preview.png');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { out = path.resolve(argv[++i]); continue; }
    const n = parseInt(argv[i], 10);
    if (Number.isInteger(n) && n >= 1 && n <= 114) surahs.push(n);
  }
  if (!surahs.length) surahs.push(2, 18, 55, 67); // Baqarah, Kahf, Ar-Rahman, Al-Mulk
  return { surahs, out };
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

function printCss() {
  const src = fs.readFileSync(path.join(ROOT, 'build-x4-pdf.js'), 'utf8');
  const m = src.match(/const PRINT_CSS = `([\s\S]*?)`;/);
  if (!m) throw new Error('Could not read PRINT_CSS from build-x4-pdf.js');
  return m[1];
}

async function main() {
  if (!fs.existsSync(EPUB_PATH)) throw new Error(`EPUB not found: ${EPUB_PATH}`);
  const { surahs, out } = parseArgs(process.argv.slice(2));

  const zip = await JSZip.loadAsync(fs.readFileSync(EPUB_PATH));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'x4-preview-'));
  try {
    const oebps = path.join(tmp, 'OEBPS');
    // Copy css + fonts + just the requested surah files.
    const ids = surahs.map(n => `surah-${String(n).padStart(3, '0')}`);
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue;
      const keep = /css\/style\.css$|\/fonts\//.test(name) ||
        ids.some(id => name.endsWith(`text/${id}.xhtml`));
      if (!keep) continue;
      const target = path.join(tmp, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await zip.file(name).async('nodebuffer'));
    }

    let cards = '';
    for (const id of ids) {
      const file = zip.file(`OEBPS/text/${id}.xhtml`);
      if (!file) { console.warn(`! ${id} not in EPUB, skipped`); continue; }
      const body = (await file.async('string')).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)[1];
      cards += `<div class="x4sheet"><div class="x4inner">${body}</div></div>`;
    }

    const frame = `<style>
      body{margin:0;background:#cfcfcf;padding:18px;display:flex;flex-wrap:wrap;gap:18px;width:auto!important}
      .x4sheet{width:${PAGE_W_PX}px;height:${PAGE_H_PX}px;background:#fff;overflow:hidden;box-shadow:0 0 0 1px #8a8a8a;flex:0 0 auto}
      .x4inner{box-sizing:border-box;width:${PAGE_W_PX}px;padding:${PAD_PX}px}
    </style>`;
    const html = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" lang="ar" dir="rtl">
<head><meta charset="utf-8"/><link rel="stylesheet" href="css/style.css"/><style>${printCss()}</style>${frame}</head>
<body>${cards}</body></html>`;
    const htmlPath = path.join(oebps, 'preview.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    // Canvas wide enough for all sheets on one row (18px gaps + padding).
    const winW = Math.ceil(18 + surahs.length * (PAGE_W_PX + 18) + 18);
    const winH = Math.ceil(PAGE_H_PX + 36 + 20);

    const chrome = findChrome();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const r = spawnSync(chrome, [
      '--headless', '--disable-gpu', '--no-sandbox', '--disable-extensions',
      '--force-device-scale-factor=2', '--hide-scrollbars',
      `--window-size=${winW},${winH}`,
      `--screenshot=${out}`,
      pathToFileURL(htmlPath).href
    ], { encoding: 'utf8', timeout: 120000 });
    if (r.error) throw r.error;
    if (!fs.existsSync(out)) throw new Error(`Chrome did not produce ${out}: ${(r.stderr || '').trim()}`);

    console.log(`Created ${path.relative(ROOT, out)} — ${surahs.length} X4 sheet(s): ${surahs.join(', ')}`);
    console.log(`Each sheet = ${PAGE_W_PX.toFixed(1)}x${PAGE_H_PX.toFixed(1)} CSS px (480x800 @ 220 PPI), clipped like one screen.`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(`Preview failed: ${err.message}`); process.exitCode = 1; });
