#!/usr/bin/env node
/* =============================================================================
 *  smoke.js — OFFLINE layout preview. No network, no API calls.
 *
 *  Builds a tiny EPUB (Al-Fatihah + start of Al-Baqarah) from hard-coded mock
 *  data, reusing the REAL builder functions from builder.js. Use it to eyeball
 *  the typography/layout before committing to the full ~460-request fetch.
 *
 *  Usage:
 *    node smoke.js                     # english edition preview
 *    node smoke.js --edition=indonesia # indonesian edition preview
 *    npm run smoke
 *
 *  Outputs:
 *    dist/quran_smoke_preview.epub          -> open in any EPUB reader
 *    build/smoke/OEBPS/title.xhtml          -> open directly in a web browser
 *    build/smoke/OEBPS/text/surah-001.xhtml -> ditto (fastest way to check CSS)
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const B = require('./builder');

const ROOT = __dirname;
const ASSETS = path.join(ROOT, 'assets');
const BUILD_DIR = path.join(ROOT, 'build', 'smoke');
const DIST = path.join(ROOT, 'dist');

/* --- pick edition -------------------------------------------------------- */
const arg = process.argv.find((a) => a.startsWith('--edition='));
const editionId = arg ? arg.split('=')[1] : 'english';
const edition = B.EDITIONS[editionId];
if (!edition) {
  console.error(`Unknown edition "${editionId}". Use english | indonesia.`);
  process.exit(1);
}

/* --- mock data ----------------------------------------------------------- */
const chapters = [
  {
    id: 1,
    name_arabic: 'الفاتحة',
    name_simple: 'Al-Fatihah',
    translated_name: { name: editionId === 'indonesia' ? 'Pembukaan' : 'The Opener' },
    revelation_place: 'makkah',
    verses_count: 7
  },
  {
    id: 2,
    name_arabic: 'البقرة',
    name_simple: 'Al-Baqarah',
    translated_name: { name: editionId === 'indonesia' ? 'Sapi Betina' : 'The Cow' },
    revelation_place: 'madinah',
    verses_count: 286
  }
];
const chaptersById = Object.fromEntries(chapters.map((c) => [c.id, c]));

const juzs = [{ juz_number: 1, verse_mapping: { 1: '1-7', 2: '1-141' } }];

// Arabic (Uthmani) + sample translations. For the Indonesian edition the Arabic
// is still correct; the translation text below is English placeholder — this is
// a LAYOUT smoke-test, not a content preview.
const V = (surah, ayah, arabic, translation) => ({ surah, ayah, arabic, translation });

const versesBySurah = {
  1: [
    V(1, 1, 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'In the name of Allah, the Entirely Merciful, the Especially Merciful.'),
    V(1, 2, 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ', '[All] praise is [due] to Allah, Lord of the worlds —'),
    V(1, 3, 'ٱلرَّحْمَٰنِ ٱلرَّحِيمِ', 'The Entirely Merciful, the Especially Merciful,'),
    V(1, 4, 'مَٰلِكِ يَوْمِ ٱلدِّينِ', 'Sovereign of the Day of Recompense.'),
    V(1, 5, 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ', 'It is You we worship and You we ask for help.'),
    V(1, 6, 'ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ', 'Guide us to the straight path —'),
    V(1, 7, 'صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّآلِّينَ', 'The path of those upon whom You have bestowed favor, not of those who have evoked [Your] anger or of those who are astray.')
  ],
  2: [
    V(2, 1, 'الٓمٓ', 'Alif, Lam, Meem.'),
    V(2, 2, 'ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ', 'This is the Book about which there is no doubt, a guidance for those conscious of Allah —'),
    V(2, 3, 'ٱلَّذِينَ يُؤْمِنُونَ بِٱلْغَيْبِ وَيُقِيمُونَ ٱلصَّلَوٰةَ وَمِمَّا رَزَقْنَٰهُمْ يُنفِقُونَ', 'Who believe in the unseen, establish prayer, and spend out of what We have provided for them,'),
    V(2, 4, 'وَٱلَّذِينَ يُؤْمِنُونَ بِمَآ أُنزِلَ إِلَيْكَ وَمَآ أُنزِلَ مِن قَبْلِكَ وَبِٱلْءَاخِرَةِ هُمْ يُوقِنُونَ', 'And who believe in what has been revealed to you, [O Muhammad], and what was revealed before you, and of the Hereafter they are certain [in faith].'),
    V(2, 5, 'أُو۟لَٰٓئِكَ عَلَىٰ هُدًى مِّن رَّبِّهِمْ ۖ وَأُو۟لَٰٓئِكَ هُمُ ٱلْمُفْلِحُونَ', 'Those are upon [right] guidance from their Lord, and it is those who are the successful.')
  ]
};

/* --- stage --------------------------------------------------------------- */
function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    B.ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  }
  return false;
}

async function run() {
  console.log(`Offline smoke preview — edition: ${editionId}`);

  const stage = BUILD_DIR;
  fs.rmSync(stage, { recursive: true, force: true });
  const oebps = path.join(stage, 'OEBPS');
  B.ensureDir(path.join(stage, 'META-INF'));
  B.ensureDir(path.join(oebps, 'text'));
  B.ensureDir(path.join(oebps, 'styles'));
  B.ensureDir(path.join(oebps, 'images'));
  B.ensureDir(path.join(oebps, 'fonts'));

  fs.writeFileSync(path.join(stage, 'mimetype'), 'application/epub+zip');
  fs.writeFileSync(path.join(stage, 'META-INF', 'container.xml'), B.CONTAINER_XML);
  fs.writeFileSync(path.join(oebps, 'styles', 'style.css'), B.buildCss(edition));

  // assets (optional — preview still works without them)
  const hasCover = copyIfExists(path.join(ASSETS, 'cover.jpg'), path.join(oebps, 'images', 'cover.jpg'));
  const hasDivider = copyIfExists(path.join(ASSETS, 'divider.png'), path.join(oebps, 'images', 'divider.png'));
  const fontFilesPresent = [];
  edition.fonts.forEach((f) => {
    if (copyIfExists(path.join(ASSETS, 'fonts', f.file), path.join(oebps, 'fonts', f.file))) {
      fontFilesPresent.push(f.file);
    }
  });

  // front matter
  fs.writeFileSync(path.join(oebps, 'cover.xhtml'), B.buildCoverXhtml(edition, hasCover));
  fs.writeFileSync(path.join(oebps, 'title.xhtml'), B.buildTitlePageXhtml(edition, hasDivider));

  // surahs
  for (const ch of chapters) {
    const verses = versesBySurah[ch.id];
    const html = B.buildSurahXhtml(edition, ch, verses, hasDivider);
    fs.writeFileSync(path.join(oebps, 'text', `surah-${B.pad3(ch.id)}.xhtml`), html);
  }

  // nav
  const juzModel = B.buildJuzModel(juzs);
  fs.writeFileSync(path.join(oebps, 'toc.xhtml'), B.buildNavXhtml(edition, juzModel, chaptersById));
  fs.writeFileSync(path.join(oebps, 'toc.ncx'), B.buildNcx(edition, juzModel, chaptersById, 'urn:uuid:quran-smoke'));

  // opf
  fs.writeFileSync(
    path.join(oebps, 'content.opf'),
    B.buildOpf(edition, chapters, fontFilesPresent, hasCover, hasDivider, 'urn:uuid:quran-smoke', '2026-01-01T00:00:00Z')
  );

  // zip
  B.ensureDir(DIST);
  const outFile = path.join(DIST, 'quran_smoke_preview.epub');
  await B.zipEpub(stage, outFile);

  const kb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`\n  EPUB     : ${path.relative(ROOT, outFile)}  (${kb} KB)`);
  console.log(`  Browser  : ${path.relative(ROOT, path.join(oebps, 'title.xhtml'))}`);
  console.log(`  Browser  : ${path.relative(ROOT, path.join(oebps, 'text', 'surah-001.xhtml'))}`);
  if (!fontFilesPresent.length) {
    console.log('\n  (no fonts in assets/fonts — Arabic shown via system fallback)');
  }
  console.log('\nOpen either .xhtml in a web browser for an instant layout check.');
}

run().catch((err) => {
  console.error('\nSMOKE FAILED:', err.message);
  process.exit(1);
});
