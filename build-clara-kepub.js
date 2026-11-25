'use strict';

/* =============================================================================
 * build-clara-kepub.js — make an Al-Qur'an KEPUB that actually renders on the
 * Kobo Clara (Colour).
 * -----------------------------------------------------------------------------
 * Kobo honours embedded @font-face (unlike the Xteink X4), BUT the Clara render
 * engine breaks full Quranic Arabic with LPMQ/Scheherazade (disconnected
 * letters) — device-verified. The confirmed fix is to embed **Amiri Quran** and
 * point the Arabic family at it. This takes the existing, Kobo-ready kepub (it
 * already has koboSpan + the EPUB2 <guide> needed for sideload) and only swaps
 * the Arabic font Scheherazade -> Amiri Quran, then repackages.
 *
 * NOTE: the PDF (dist/.../pdf/Kobo-Clara/) keeps the Kemenag (LPMQ) font because
 * there the glyphs are baked/pre-shaped by Chrome, so they render correctly. In
 * a reflow kepub the device does the shaping, so Kemenag can't be used.
 *
 *   node build-clara-kepub.js
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'dist', 'Al-Quran', 'kepub', 'Kobo', 'Al-Quran.kepub.epub');
const OUT = path.join(ROOT, 'dist', 'Al-Quran', 'kepub', 'Kobo', 'Al-Quran (Clara).kepub.epub');
const OLD_FONT = 'ScheherazadeNew-Regular.ttf';
const NEW_FONT = { file: 'AmiriQuran-Regular.ttf', src: path.join(ROOT, 'assets', 'fonts', 'AmiriQuran-Regular.ttf') };

function tagTitle(opf) {
  return opf
    .replace(/(<dc:title\b[^>]*>)([\s\S]*?)(<\/dc:title>)/i,
      (m, o, t, c) => /Clara/i.test(t) ? m : `${o}${t} (Clara)${c}`)
    .replace(/(<dc:identifier\b[^>]*>)([\s\S]*?)(<\/dc:identifier>)/i,
      (m, o, t, c) => /clara/i.test(t) ? m : `${o}${t}-clara${c}`);
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Source kepub not found: ${SRC}`);
  if (!fs.existsSync(NEW_FONT.src)) throw new Error(`Amiri Quran font not found: ${NEW_FONT.src}`);

  const src = await JSZip.loadAsync(fs.readFileSync(SRC));
  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  let swapped = false;
  let fontDir = 'OEBPS/fonts';
  for (const name of Object.keys(src.files)) {
    if (name === 'mimetype') continue;
    const entry = src.files[name];
    if (entry.dir) continue;

    if (new RegExp(`fonts/${OLD_FONT.replace('.', '\\.')}$`).test(name)) {
      // Replace the old Arabic font with Amiri Quran (same folder, new filename).
      fontDir = path.posix.dirname(name);
      out.file(`${fontDir}/${NEW_FONT.file}`, fs.readFileSync(NEW_FONT.src));
      swapped = true;
    } else if (/\.(css|opf)$/i.test(name)) {
      // Repoint every reference to the old font at Amiri Quran; tag title/id in opf.
      let text = (await entry.async('string')).split(OLD_FONT).join(NEW_FONT.file);
      if (/\.opf$/i.test(name)) text = tagTitle(text);
      out.file(name, text);
    } else {
      out.file(name, await entry.async('nodebuffer'));
    }
  }
  if (!swapped) throw new Error(`Did not find the old font ${OLD_FONT} to replace.`);

  const buf = await out.generateAsync({
    type: 'nodebuffer', mimeType: 'application/epub+zip',
    compression: 'DEFLATE', compressionOptions: { level: 9 },
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);

  // Sanity: reopen, confirm mimetype, font embedded, font referenced, guide kept.
  const check = await JSZip.loadAsync(buf);
  const mime = await check.file('mimetype').async('string');
  const names = Object.keys(check.files).filter(n => !check.files[n].dir);
  const css = await check.file(names.find(n => /\.css$/.test(n))).async('string');
  const opf = await check.file(names.find(n => /\.opf$/.test(n))).async('string');
  const ok = mime === 'application/epub+zip'
    && names.some(n => n.endsWith(NEW_FONT.file))
    && css.includes(NEW_FONT.file) && !css.includes(OLD_FONT)
    && /<guide>/.test(opf);
  if (!ok) throw new Error('Output kepub failed its sanity check.');

  console.log(`Created ${path.relative(ROOT, OUT)} (${(buf.length / 1048576).toFixed(2)} MB)`);
  console.log(`  Arabic font: Amiri Quran (embedded) · <guide> kept · koboSpan preserved`);
}

main().catch(err => { console.error(`Failed: ${err.message}`); process.exitCode = 1; });
