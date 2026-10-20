#!/usr/bin/env node
/* =============================================================================
 *  prep-cover.js — optimize ONE cover image into a lightweight EPUB cover.
 *
 *  Why: e-readers (and lynk.id uploads) choke on multi-MB covers. This shrinks
 *  the raw art to a sane width and re-encodes as progressive mozjpeg so the
 *  cover stays crisp but small (target well under ~300 KB).
 *
 *  Usage:
 *    node prep-cover.js assets/juzamma-cover-raw.jpg           # -> assets/cover.jpg
 *    node prep-cover.js <input> [output.jpg] [maxWidth]
 * ===========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const [, , inArg, outArg, widthArg] = process.argv;

if (!inArg) {
  console.error('Usage: node prep-cover.js <input-image> [output.jpg] [maxWidth]');
  process.exit(1);
}

const SRC = path.isAbsolute(inArg) ? inArg : path.join(__dirname, inArg);
const OUT = outArg
  ? (path.isAbsolute(outArg) ? outArg : path.join(__dirname, outArg))
  : path.join(__dirname, 'assets', 'cover.jpg');
const MAX_W = Number(widthArg) || 1400; // 1400px is plenty for a cover; keeps size small

(async () => {
  if (!fs.existsSync(SRC)) { console.error('Input not found:', SRC); process.exit(1); }

  const src = await sharp(SRC).metadata();

  await sharp(SRC)
    .resize({ width: MAX_W, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true, progressive: true })
    .toFile(OUT);

  const out = await sharp(OUT).metadata();
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`cover: ${src.width}x${src.height} -> ${out.width}x${out.height}  (${kb} KB)  ${path.relative(__dirname, OUT)}`);
  if (kb > 400) console.log('  note: still >400 KB — rerun with a smaller maxWidth, e.g. node prep-cover.js <in> assets/cover.jpg 1100');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
