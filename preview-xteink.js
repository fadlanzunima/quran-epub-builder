'use strict';

/* =============================================================================
 * preview-xteink.js — render device-sized "sheets" to a PNG for visual QA.
 * -----------------------------------------------------------------------------
 * Renders chosen surahs as fixed Xteink screens (clipped like one device page)
 * using the SAME DEVICES + printCss as build-xteink-pdf.js, so this previews
 * exactly what the real PDF produces.
 *
 *   node preview-xteink.js x4              # default surahs on the X4 screen
 *   node preview-xteink.js x3 1 36 112     # X3 screen, pick surah numbers
 *   node preview-xteink.js x4 --out a.png 2
 *
 * Output (default): dist/x4-preview.png / dist/x3-preview.png. Needs Chrome/Edge.
 * ========================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const { DEVICES, geometry, printCss, QURAN_FONT } = require('./build-xteink-pdf.js');

const ROOT = __dirname;
const EPUB_PATH = path.join(ROOT, 'dist', 'Al-Quran', 'epub', 'Universal', 'Al-Quran.epub');
const MM_PER_IN = 25.4;

function parseArgs(argv) {
  let device = 'x4';
  let out = null;
  const surahs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { out = path.resolve(argv[++i]); continue; }
    if (DEVICES[a.toLowerCase()]) { device = a.toLowerCase(); continue; }
    const n = parseInt(a, 10);
    if (Number.isInteger(n) && n >= 1 && n <= 114) surahs.push(n);
  }
  if (!surahs.length) surahs.push(2, 18, 55, 67); // Baqarah, Kahf, Ar-Rahman, Al-Mulk
  if (!out) out = path.join(ROOT, 'dist', `${device}-preview.png`);
  return { device, surahs, out };
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

async function main() {
  if (!fs.existsSync(EPUB_PATH)) throw new Error(`EPUB not found: ${EPUB_PATH}`);
  const { device, surahs, out } = parseArgs(process.argv.slice(2));
  const dev = DEVICES[device];
  const g = geometry(dev);
  const pageWpx = (g.widthMm / MM_PER_IN) * 96;   // CSS px
  const pageHpx = (g.heightMm / MM_PER_IN) * 96;
  const padPx = (dev.type.marginMm / MM_PER_IN) * 96;

  const zip = await JSZip.loadAsync(fs.readFileSync(EPUB_PATH));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xteink-preview-'));
  try {
    const oebps = path.join(tmp, 'OEBPS');
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

    // Bake in the same Quran font as the PDF so the preview matches.
    if (fs.existsSync(QURAN_FONT.src)) {
      fs.mkdirSync(path.join(oebps, 'fonts'), { recursive: true });
      fs.copyFileSync(QURAN_FONT.src, path.join(oebps, 'fonts', QURAN_FONT.file));
    }

    let cards = '';
    for (const id of ids) {
      const file = zip.file(`OEBPS/text/${id}.xhtml`);
      if (!file) { console.warn(`! ${id} not in EPUB, skipped`); continue; }
      const body = (await file.async('string')).match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)[1];
      cards += `<div class="xsheet"><div class="xinner">${body}</div></div>`;
    }

    const frame = `<style>
      html{direction:ltr}
      body{margin:0;background:#cfcfcf;padding:18px;display:flex;flex-wrap:nowrap;gap:18px;width:max-content!important}
      .xsheet{width:${pageWpx}px;height:${pageHpx}px;background:#fff;overflow:hidden;box-shadow:0 0 0 1px #8a8a8a;flex:0 0 auto}
      .xinner{box-sizing:border-box;width:${pageWpx}px;padding:${padPx}px}
    </style>`;
    const html = `<!doctype html><html xmlns="http://www.w3.org/1999/xhtml" lang="ar" dir="rtl">
<head><meta charset="utf-8"/><link rel="stylesheet" href="css/style.css"/><style>${printCss(dev)}</style>${frame}</head>
<body>${cards}</body></html>`;
    const htmlPath = path.join(oebps, 'preview.html');
    fs.writeFileSync(htmlPath, html, 'utf8');

    const winW = Math.ceil(18 + surahs.length * (pageWpx + 18) + 18);
    const winH = Math.ceil(pageHpx + 36 + 20);

    const chrome = findChrome();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (fs.existsSync(out)) fs.unlinkSync(out);
    const r = spawnSync(chrome, [
      '--headless', '--disable-gpu', '--no-sandbox', '--disable-extensions',
      '--force-device-scale-factor=2', '--hide-scrollbars',
      `--window-size=${winW},${winH}`, `--screenshot=${out}`,
      pathToFileURL(htmlPath).href
    ], { encoding: 'utf8', timeout: 120000 });
    if (r.error) throw r.error;
    if (!fs.existsSync(out)) throw new Error(`Chrome did not produce ${out}: ${(r.stderr || '').trim()}`);

    console.log(`Created ${path.relative(ROOT, out)} — ${dev.label}`);
    console.log(`${surahs.length} sheet(s): ${surahs.join(', ')} · each ${pageWpx.toFixed(1)}x${pageHpx.toFixed(1)} CSS px (${g.wpx}x${g.hpx} @ ${g.ppi} PPI).`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(`Preview failed: ${err.message}`); process.exitCode = 1; });
