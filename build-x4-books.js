'use strict';

/* =============================================================================
 * build-x4-books.js — repack the Dzikir and Juz 'Amma EPUBs into lightweight,
 * reflow-friendly variants tuned for the Xteink X4 (480x800, 4.3" e-ink).
 * -----------------------------------------------------------------------------
 *  • Reflowable: text follows the X4 screen and the reader's own font-size
 *    setting — all sizes are em-based (the source Dzikir CSS used fixed px that
 *    neither scale nor fit the small screen).
 *  • Slim decoration: heavy frames / divider images stripped so the ESP32
 *    reader lays out fast and the narrow screen stays uncluttered.
 *  • Embedded @font-face kept so readers that honour it (Boox, Kobo, Calibre,
 *    Apple Books) still render the Arabic face.
 *  • Proper daftar isi kept: the EPUB3 nav + toc.ncx carry over untouched; the
 *    Dzikir TOC page loses its fixed-px inline styles so the CSS can scale it.
 *
 *  IMPORTANT — the X4 itself ignores @font-face. For correct Arabic ON THE X4
 *  you must load an Arabic TTF as a device .bin font (see XTEINK-X4-NOTES.md).
 *  This EPUB is the clean, reflow-friendly text the device renders with it.
 *
 *    node build-x4-books.js            both
 *    node build-x4-books.js dzikir     only Dzikir
 *    node build-x4-books.js juzamma    only Juz 'Amma
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT = __dirname;

// "Font Kemenag" = LPMQ Isep Misbah (Kemenag Mushaf Standar Indonesia) — the
// same Arabic face baked into the Al-Quran outputs. Embedded here as the
// 'QuranArabic' family both books' Arabic text already (or now) references.
const KEMENAG_FONT = {
  src: path.join(ROOT, 'assets', 'fonts', 'LPMQ-IsepMisbah.ttf'),
  file: 'LPMQ-IsepMisbah.ttf',
};

// Full replacement CSS for Dzikir: em-based so it reflows to the X4 and the
// reader's font size. Mirrors the original class names; drops the tiny fixed px.
const DZIKIR_X4_CSS = `
:root{--ink:#000;--paper:#fff;--muted:#333;--accent:#1a472a;--rule:#2c5f2d;}
*{box-sizing:border-box;}
html,body{margin:0;background:var(--paper);color:var(--ink);}
body{font-family:Georgia,"Times New Roman",serif;font-size:100%;line-height:1.5;padding:0 3%;-webkit-hyphens:none;hyphens:none;}

h1{font-size:1.3em;text-align:center;color:var(--accent);margin:.6em 0 .5em;padding-bottom:.3em;border-bottom:1px solid var(--rule);}

.time-badge{display:block;width:fit-content;margin:0 auto .6em;text-align:center;font-size:.85em;color:#fff;background:var(--rule);padding:.2em .8em;border-radius:1em;}
.count-badge{display:block;width:fit-content;margin:.6em auto;text-align:center;font-size:.9em;font-weight:bold;color:#000;border:1px solid var(--ink);padding:.2em .8em;border-radius:1em;}

/* Arabic — reflows; em-based so the reader's font-size setting works on the X4 */
.arabic-text{
  font-family:'QuranArabic',"Noto Naskh Arabic","Amiri","Scheherazade New","Traditional Arabic",serif;
  font-size:1.6em;line-height:2.0;text-align:right;direction:rtl;unicode-bidi:bidi-override;
  color:var(--ink);margin:.6em 0;padding:.3em 0 .6em;border-bottom:1px solid var(--rule);
  white-space:pre-line;word-spacing:.05em;
  font-feature-settings:"liga" 1,"calt" 1;-webkit-font-feature-settings:"liga" 1,"calt" 1;
}
.latin-text{display:none;}
.translation{font-size:.95em;text-align:left;color:var(--muted);margin:.6em 0;padding:.3em .5em;border-left:1px solid var(--rule);line-height:1.6;}
.reference{font-size:.8em;font-style:italic;color:var(--muted);text-align:right;margin:.5em 0;padding:.3em 0;border-top:1px solid #bbb;}

/* Cover (text cover) — em-based */
.cover-container{text-align:center;padding:2em 1em;background:var(--accent);color:#fff;min-height:100vh;}
.cover-title{font-size:2em;color:#ffd700;margin:.5em 0;font-weight:bold;}
.cover-subtitle{font-size:1.3em;color:#fff;margin:.5em 0;}
.cover-decoration{font-size:2.2em;color:#ffd700;margin:.6em 0;}
.cover-tagline{font-size:1em;color:#c8e6c9;margin:.6em 0;font-style:italic;}
.cover-publisher{font-size:.9em;color:#e8f5e9;margin-top:1.2em;}

/* Intro */
.intro-section{padding:.6em;margin:.6em 0;border:1px solid #ccc;border-radius:3px;}
.intro-section h2{color:var(--rule);text-align:center;border-bottom:1px solid var(--rule);padding-bottom:.25em;margin-bottom:.4em;font-size:1.1em;}
.time-info{margin:.3em 0;padding:.3em;border-left:1px solid var(--rule);font-size:.9em;}

/* Daftar isi (TOC) — readable, scales with reader font-size */
nav[role="doc-toc"] h1{font-size:1.3em;}
.toc-section{color:var(--accent);font-weight:bold;font-size:1.05em;margin:.8em 0 .3em;text-align:center;border-bottom:1px solid var(--rule);padding-bottom:.15em;}
.toc-list,nav[role="doc-toc"] ol{list-style:none;padding:0;margin:.3em 0;}
.toc-list li,nav[role="doc-toc"] li{margin:.15em 0;padding:.25em .4em;border-left:1px solid var(--rule);line-height:1.4;}
.toc-list a,nav[role="doc-toc"] a{color:var(--accent);text-decoration:none;font-size:1em;}
.toc-badge{background:var(--rule);color:#fff;padding:.05em .5em;border-radius:.8em;font-size:.75em;margin-left:.4em;}
nav[role="doc-toc"] ol ol{margin-left:1em;margin-top:.3em;}
`;

// Override block appended to the Juz 'Amma CSS: it is already em-based and
// e-ink safe, so we only tighten spacing and size the Arabic to fit 480px, and
// strip the heavy mushaf frame/divider (unused by the bilingual pages anyway).
const JUZAMMA_X4_OVERRIDE = `
/* ===== Xteink X4 overrides (reflow, 480x800) ===== */
body{padding:0 3%;}
.page{border:0;padding:0;margin:0;}
.surah-divider{display:none;}
.judul-surah{font-size:1.65em;}
.basmalah{font-family:'QuranArabic',"Scheherazade New",serif;direction:rtl;text-align:center;font-size:1.45em;line-height:1.9;margin:.5em 0 .8em;}
.teks-arab{font-size:1.5em;line-height:2.15;}
.nomor-ayat{font-size:.5em;}
.teks-latin{font-size:.95em;}
.teks-terjemahan{font-size:1em;}
`;

const BOOKS = {
  dzikir: {
    src: path.join(ROOT, 'dist', 'Dzikir Pagi Petang', 'epub', 'Universal', 'dzikir pagi petang.epub'),
    out: path.join(ROOT, 'dist', 'Dzikir Pagi Petang', 'epub', 'Xteink-X4', 'Dzikir Pagi dan Petang Xteink X4.epub'),
    cssRe: /styles\.css$/,
    mode: 'replace',
    css: DZIKIR_X4_CSS,
    stripInlineStyleIn: /(toc\.xhtml|toc-pagi\.xhtml|toc-petang\.xhtml)$/,
    fontCssRel: 'fonts/LPMQ-IsepMisbah.ttf', // styles.css sits at OEBPS root
  },
  juzamma: {
    src: path.join(ROOT, 'dist', 'Juz Amma', 'epub', 'Universal', "Juz 'Amma & Terjemahan.epub"),
    out: path.join(ROOT, 'dist', 'Juz Amma', 'epub', 'Xteink-X4', "Juz 'Amma & Terjemahan Xteink X4.epub"),
    cssRe: /css\/style\.css$/,
    mode: 'append',
    css: JUZAMMA_X4_OVERRIDE,
    fontCssRel: '../fonts/LPMQ-IsepMisbah.ttf', // css/style.css sits in OEBPS/css
  },
};

function extractFontFaces(css) {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  return faces.join('\n');
}

// Tag the device-library title so the X4 variant is distinct from the original.
function tagTitle(opf) {
  return opf.replace(/(<dc:title\b[^>]*>)([\s\S]*?)(<\/dc:title>)/i, (m, open, text, close) => {
    if (/Xteink X4/i.test(text)) return m;
    return `${open}${text} (Xteink X4)${close}`;
  });
}

async function buildBook(key) {
  const book = BOOKS[key];
  if (!book) throw new Error(`Unknown book "${key}". Choose from: ${Object.keys(BOOKS).join(', ')}.`);
  if (!fs.existsSync(book.src)) throw new Error(`Source EPUB not found: ${book.src}`);

  if (!fs.existsSync(KEMENAG_FONT.src)) throw new Error(`Kemenag font not found: ${KEMENAG_FONT.src}`);

  const src = await JSZip.loadAsync(fs.readFileSync(book.src));
  const cssName = Object.keys(src.files).find(n => book.cssRe.test(n));
  if (!cssName) throw new Error(`Stylesheet matching ${book.cssRe} not found in ${book.src}.`);
  const origCss = await src.file(cssName).async('string');

  const opfName = Object.keys(src.files).find(n => /\.opf$/.test(n) && !src.files[n].dir);
  if (!opfName) throw new Error('No .opf found in source EPUB.');
  const opfDir = path.posix.dirname(opfName);               // e.g. "OEBPS"
  const fontHref = `fonts/${KEMENAG_FONT.file}`;            // relative to the OPF
  const fontTarget = opfDir === '.' ? fontHref : `${opfDir}/${fontHref}`;

  // The Kemenag (LPMQ) @font-face for the 'QuranArabic' family. Declared LAST so
  // it overrides any same-named face already in the book's stylesheet.
  const kemenagFace = `@font-face{font-family:'QuranArabic';font-style:normal;font-weight:400;font-display:swap;src:url('${book.fontCssRel}') format('truetype');}`;

  // Build the new archive — mimetype MUST be first and STORED (uncompressed).
  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  for (const name of Object.keys(src.files)) {
    if (name === 'mimetype') continue;
    const entry = src.files[name];
    if (entry.dir) continue;

    if (name === cssName) {
      const faces = extractFontFaces(origCss);
      const css = book.mode === 'append'
        ? `${origCss}\n${book.css}\n${kemenagFace}`
        : `${faces}\n${kemenagFace}\n${book.css}`;
      out.file(name, css);
    } else if (name === opfName) {
      let opf = tagTitle(await entry.async('string'));
      if (!opf.includes(fontHref)) {
        opf = opf.replace(/<\/manifest>/i,
          `  <item id="font-kemenag" href="${fontHref}" media-type="font/ttf"/>\n</manifest>`);
      }
      out.file(name, opf);
    } else if (book.stripInlineStyleIn && book.stripInlineStyleIn.test(name)) {
      // Remove fixed-px inline styles so the em-based CSS governs the TOC on X4.
      let doc = await entry.async('string');
      doc = doc.replace(/\s+style\s*=\s*"[^"]*"/gi, '');
      out.file(name, doc);
    } else {
      out.file(name, await entry.async('nodebuffer'));
    }
  }

  // Embed the Kemenag font.
  out.file(fontTarget, fs.readFileSync(KEMENAG_FONT.src));

  const buf = await out.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.mkdirSync(path.dirname(book.out), { recursive: true });
  fs.writeFileSync(book.out, buf);

  // Sanity check: reload and confirm it opens and mimetype is intact.
  const check = await JSZip.loadAsync(buf);
  const mime = await check.file('mimetype').async('string');
  if (mime !== 'application/epub+zip') throw new Error('mimetype is corrupt in the output EPUB.');

  const sizeMb = (buf.length / (1024 * 1024)).toFixed(2);
  console.log(`Created ${path.relative(ROOT, book.out)} (${sizeMb} MB).`);
}

async function main() {
  const arg = (process.argv[2] || 'all').toLowerCase();
  const keys = arg === 'all' ? Object.keys(BOOKS) : [arg];
  for (const key of keys) await buildBook(key);
  console.log('NOTE: the X4 ignores EPUB @font-face — load an Arabic .bin device font for on-device Arabic (see XTEINK-X4-NOTES.md).');
}

main().catch(error => {
  console.error(`Failed to build Xteink X4 EPUB: ${error.message}`);
  process.exitCode = 1;
});
