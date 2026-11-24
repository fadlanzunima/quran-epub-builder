'use strict';

/* =============================================================================
 * build-x4-epub.js — repack Al-Quran.epub into a lightweight EPUB for Xteink X4.
 * -----------------------------------------------------------------------------
 * The X4 runs on an ESP32 MCU with limited EPUB processing. This variant:
 *   • keeps the content reflowable, so text follows the 480x800 screen and the
 *     reader's own font-size setting (this is the X4's native strength);
 *   • strips heavy decoration (4px double page frame, divider image, banners
 *     slimmed) that clutters a 4.3" screen and taxes the MCU;
 *   • KEEPS the embedded @font-face so readers that DO honour it (Boox, Kobo,
 *     Calibre, Apple Books) still render the Uthmani font.
 *
 * IMPORTANT — the X4 itself ignores @font-face. For correct Arabic ON THE X4
 * you must load an Arabic TTF as a device font converted to Xteink's .bin
 * format. See XTEINK-X4-NOTES.md. This EPUB is the clean, reflow-friendly text
 * the device renders with that device font.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT = __dirname;
const SRC_EPUB = path.join(ROOT, 'dist', 'Al-Quran.epub');
const OUT_EPUB = path.join(ROOT, 'dist', 'Al-Quran Xteink X4.epub');
// Dedicated cover for the Xteink build (ornate line-art, reads well on e-ink).
const X4_COVER = path.join(ROOT, 'assets', 'Gemini_Generated_Image_tzoyi8tzoyi8tzoy.jpg');

// Lightweight CSS tuned for the X4 (480x800). Decoration kept minimal so the
// ESP32 reader lays out fast and the small screen stays uncluttered. The
// @font-face block from the source CSS is preserved verbatim (see below).
function x4Css(fontFaceRule) {
  return `${fontFaceRule}
:root{--ink:#000;--paper:#fff;--muted:#222;--rule:#000;}
*{box-sizing:border-box;}
html,body{margin:0;background:var(--paper);color:var(--ink);}
body{padding:0 3%;font-family:'QuranArabic',"Amiri Quran","Scheherazade New",serif;line-height:1.85;-webkit-hyphens:none;hyphens:none;}

/* No heavy frame on the X4: a 4px double border wastes the narrow screen and
   taxes the MCU. Just a little breathing room per surah page. */
.page{border:0;padding:0;margin:0 0 .4em;}

/* Slim surah header (single hairline, no rounded cartouche cost) */
.surah-banner{border:0;border-bottom:1px solid var(--ink);border-radius:0;padding:.2em 0 .5em;margin:.2em 0 .7em;text-align:center;}
.surah-name-ar{font-family:'QuranArabic',serif;font-size:1.55em;line-height:1.35;}
.surah-name-tr{font-size:.9em;letter-spacing:.03em;color:var(--muted);margin-top:.1em;}
.surah-meta{font-size:.7em;color:var(--muted);margin-top:.15em;direction:rtl;}

.bismillah{font-family:'QuranArabic',serif;direction:rtl;text-align:center;font-size:1.35em;margin:.5em 0 .8em;}

/* Divider image removed on the X4 (BMP/JPG-only firmware + clutter). */
.surah-divider{display:none;}

/* Continuous Arabic flow — reflows to the screen and the reader's font size. */
.quran-flow{direction:rtl;text-align:justify;text-align-last:right;font-family:'QuranArabic',serif;font-size:1.4em;line-height:2.0;}
.ayah{display:inline;}

.page-num{text-align:center;font-family:'QuranArabic',serif;font-size:.9em;color:var(--muted);margin:.5em 0 0;}

/* Ayah-end medallion kept (cheap single border, no box-shadow). */
.ayah-num{font-family:'QuranArabic',"Scheherazade New",serif;display:inline-block;box-sizing:content-box;min-width:1.05em;padding:.04em .32em;margin:0 .28em;font-size:.58em;line-height:1.2;text-align:center;vertical-align:middle;color:var(--ink);background:var(--paper);border:1.5px solid var(--ink);border-radius:1.4em;}

.toc-juz{font-weight:bold;}
h1,h2{text-align:center;font-weight:normal;}
.cover-wrap{width:100%;height:100vh;min-height:100%;margin:0;padding:0;display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center;background:var(--paper);}
.cover-wrap img{width:100%;height:100%;max-width:100%;max-height:100vh;object-fit:contain;object-position:center;}
`;
}

async function main() {
  if (!fs.existsSync(SRC_EPUB)) throw new Error(`Source EPUB not found: ${SRC_EPUB}`);

  const srcBuf = fs.readFileSync(SRC_EPUB);
  const src = await JSZip.loadAsync(srcBuf);

  // Load the dedicated Xteink cover (swapped in for images/cover.jpg below).
  if (!fs.existsSync(X4_COVER)) throw new Error(`Xteink cover not found: ${X4_COVER}`);
  const coverBuf = fs.readFileSync(X4_COVER);

  // Pull the @font-face rule out of the original CSS so the embedded font stays
  // wired up (readers that honour it keep the Uthmani face).
  const cssEntry = Object.keys(src.files).find(n => /css\/style\.css$/.test(n));
  if (!cssEntry) throw new Error('style.css not found in source EPUB.');
  const origCss = await src.file(cssEntry).async('string');
  const faceMatch = origCss.match(/@font-face\{[^}]*\}/);
  const fontFaceRule = faceMatch ? faceMatch[0] : '/* no embedded font found */';

  // Build the new archive. mimetype MUST be first + STORED (uncompressed).
  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  const order = Object.keys(src.files).filter(n => n !== 'mimetype');
  for (const name of order) {
    const entry = src.files[name];
    if (entry.dir) continue;
    if (name === cssEntry) {
      out.file(name, x4Css(fontFaceRule));
    } else if (/\/images\/cover\.jpg$/.test(name)) {
      // Swap in the dedicated Xteink cover (same path + JPEG, so the OPF
      // cover-image manifest entry and media-type stay valid).
      out.file(name, coverBuf);
    } else if (/\/images\/divider\.png$/.test(name)) {
      // Drop the divider image from the X4 build (references stripped below).
      continue;
    } else if (/content\.opf$/.test(name)) {
      // Remove the divider manifest item so no href dangles.
      let opf = await entry.async('string');
      opf = opf.replace(/\s*<item[^>]*href="images\/divider\.png"[^>]*\/>/g, '');
      out.file(name, opf);
    } else if (/text\/surah-\d{3}\.xhtml$/.test(name)) {
      // Strip the divider <img> (CSS hides it, but removing avoids a dead href).
      let doc = await entry.async('string');
      doc = doc.replace(/\s*<img[^>]*class="surah-divider"[^>]*\/>/g, '');
      out.file(name, doc);
    } else {
      out.file(name, await entry.async('nodebuffer'));
    }
  }

  const buf = await out.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.writeFileSync(OUT_EPUB, buf);

  const sizeMb = (buf.length / (1024 * 1024)).toFixed(2);
  console.log(`Created ${path.relative(ROOT, OUT_EPUB)} (${sizeMb} MB).`);
  console.log(`Embedded font kept: ${fontFaceRule.includes('url(') ? 'yes (for Boox/Kobo/Calibre)' : 'none'}.`);
  console.log(`Divider image removed; page frame & cartouche slimmed for the 480x800 screen.`);
  console.log(`NOTE: the X4 itself needs the Arabic font as a .bin device font — see XTEINK-X4-NOTES.md.`);
}

main().catch(error => {
  console.error(`Failed to build Xteink X4 EPUB: ${error.message}`);
  process.exitCode = 1;
});
