#!/usr/bin/env node
/* =============================================================================
 *  prep-assets.js — turn the raw Gemini images into build-ready assets.
 *
 *    cover.jpg   <- resized main cover (max 1600px wide)
 *    divider.png <- the horizontal ornament band, cropped, white keyed to
 *                   transparent so it looks right on white, E-Ink AND dark mode
 *
 *  Run once after dropping the raw Gemini_*.jpg files into assets/:
 *    node prep-assets.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS = path.join(__dirname, 'assets');
const SRC_COVER = path.join(ASSETS, 'Gemini_Generated_Image_we9litwe9litwe9l.jpg');
const SRC_DIVIDER = path.join(ASSETS, 'Gemini_Generated_Image_b5b14rb5b14rb5b1.jpg');

async function makeCover() {
  const out = path.join(ASSETS, 'cover.jpg');
  await sharp(SRC_COVER)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(out);
  const { width, height } = await sharp(out).metadata();
  console.log(`cover.jpg   : ${width}x${height}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

async function makeDivider() {
  const out = path.join(ASSETS, 'divider.png');
  const meta = await sharp(SRC_DIVIDER).metadata();

  // The source (≈2048²) holds a wide horizontal band in its upper third and a
  // small medallion lower down. Crop just the band.
  const top = Math.round(meta.height * 0.185);
  const bandH = Math.round(meta.height * 0.17);
  // Two passes: sharp reorders extract+trim within one pipeline, so crop the
  // band first, THEN trim the white margins on the resulting buffer.
  const band = await sharp(SRC_DIVIDER)
    .extract({ left: 0, top, width: meta.width, height: bandH })
    .toBuffer();
  const cropped = await sharp(band)
    .trim({ threshold: 20 }) // shave the white margins around the art
    .toBuffer();

  // Key white -> transparent: alpha = darkness, so black lines stay opaque and
  // the paper drops out. Works on white pages, E-Ink, and (via CSS invert in
  // dark mode) dark themes too.
  const { data, info } = await sharp(cropped)
    .flatten({ background: '#ffffff' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.722 * data[i + 2];
    const alpha = 255 - Math.round(lum); // white->0, black->255
    data[i] = 0;         // force the ink to pure black for crisp E-Ink
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = alpha;
  }

  await sharp(data, { raw: { width, height, channels } })
    .resize({ width: 1100, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(out);

  const m = await sharp(out).metadata();
  console.log(`divider.png : ${m.width}x${m.height}  (${(fs.statSync(out).size / 1024).toFixed(0)} KB, transparent)`);
}

(async () => {
  if (!fs.existsSync(SRC_COVER)) { console.error('missing', SRC_COVER); process.exit(1); }
  if (!fs.existsSync(SRC_DIVIDER)) { console.error('missing', SRC_DIVIDER); process.exit(1); }
  await makeCover();
  await makeDivider();
  console.log('\nAssets ready. Now run:  node builder.js');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
