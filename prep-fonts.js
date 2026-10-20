#!/usr/bin/env node
/* =============================================================================
 *  prep-fonts.js — unpack the font archives in assets/fonts/ into the exact
 *  file names builder.js expects.
 *
 *    ScheherazadeNew-Regular.ttf   (Indonesian Arabic + English fallback)
 *    AmiriQuran-Regular.ttf        (English fallback)
 *    UthmanicHafs.otf              (English primary, KFGQPC Uthmanic HAFS)
 *
 *  LPMQ Isep Misbah is NOT provided as a standalone file (it ships inside the
 *  "Quran Kemenag in MS Word" installer .exe in QKIW 2023.rar), so the
 *  Indonesian edition uses Scheherazade New as its embedded Arabic face.
 *
 *  Run:  node prep-fonts.js
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const FONTS = path.join(__dirname, 'assets', 'fonts');

// which entry (by regex) in which zip maps to which canonical output name
const JOBS = [
  { zip: 'kfgqpc-uthmanic-script-hafs-regular.zip', match: /\.otf$/i, out: 'UthmanicHafs.otf' },
  { zip: 'Amiri_Quran,Scheherazade_New.zip', match: /AmiriQuran-Regular\.ttf$/i, out: 'AmiriQuran-Regular.ttf' },
  { zip: 'Scheherazade_New.zip', match: /ScheherazadeNew-Regular\.ttf$/i, out: 'ScheherazadeNew-Regular.ttf' },
  { zip: 'LPMQ IsepMisbah.zip', match: /\.ttf$/i, out: 'LPMQ-IsepMisbah.ttf' }
];

(async () => {
  for (const job of JOBS) {
    const zipPath = path.join(FONTS, job.zip);
    if (!fs.existsSync(zipPath)) { console.warn(`  ! missing archive: ${job.zip}`); continue; }
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const entry = Object.keys(zip.files).find((n) => !zip.files[n].dir && job.match.test(n));
    if (!entry) { console.warn(`  ! no match in ${job.zip}`); continue; }
    const buf = await zip.file(entry).async('nodebuffer');
    fs.writeFileSync(path.join(FONTS, job.out), buf);
    console.log(`  ${job.out}  <-  ${job.zip}:${entry}  (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log('\nFonts unpacked. (LPMQ Isep Misbah unavailable -> Indonesian uses Scheherazade New.)');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
