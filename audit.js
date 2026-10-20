#!/usr/bin/env node
/* Offline EPUB sanity audit: the checks that actually make epubcheck fail and
 * block store uploads (undeclared resources, missing files, broken links,
 * spine/manifest mismatches). Not a substitute for epubcheck, but catches the
 * common hard errors. */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function resolveHref(fromRel, href) {
  // fromRel is relative to OEBPS (e.g. 'toc.xhtml' or 'text/surah-001.xhtml')
  const base = path.posix.dirname(fromRel);
  return path.posix.normalize(path.posix.join(base === '.' ? '' : base, href));
}

(async () => {
  let grandErr = 0;
  for (const f of ['quran_indonesia_kemenag.epub', 'quran_english_uthmani.epub']) {
    console.log('\n### ' + f);
    const z = await JSZip.loadAsync(fs.readFileSync(path.join('dist', f)));
    const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
    const opf = await z.file('OEBPS/content.opf').async('string');

    const man = [...opf.matchAll(/<item\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
    const manIds = [...opf.matchAll(/<item\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    const spine = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g)].map((m) => m[1]);
    let err = 0;

    // 1) every OEBPS resource (except the opf) must be declared in manifest
    const declared = new Set(man.map((h) => 'OEBPS/' + h));
    for (const n of names) {
      if (!n.startsWith('OEBPS/') || n === 'OEBPS/content.opf') continue;
      if (!declared.has(n)) { console.log('  ERR undeclared resource:', n); err++; }
    }
    // 2) every manifest href exists in the zip
    for (const h of man) if (!names.includes('OEBPS/' + h)) { console.log('  ERR manifest -> missing file:', h); err++; }
    // 3) every spine idref exists in manifest
    for (const id of spine) if (!manIds.includes(id)) { console.log('  ERR spine idref not in manifest:', id); err++; }

    // 4) internal fragment links resolve to real ids
    const idCache = {};
    async function idsOf(rel) {
      if (rel in idCache) return idCache[rel];
      const file = z.file('OEBPS/' + rel);
      if (!file) return (idCache[rel] = null);
      const t = await file.async('string');
      return (idCache[rel] = new Set([...t.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
    }
    async function checkLinks(rel) {
      const t = await z.file('OEBPS/' + rel).async('string');
      const hrefs = [...t.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
        .filter((h) => !/^https?:|^mailto:/.test(h));
      for (const h of hrefs) {
        const [p, frag] = h.split('#');
        const target = p ? resolveHref(rel, p) : rel;
        if (!names.includes('OEBPS/' + target)) {
          // skip css/font/image (already checked via manifest) only if truly absent
          if (!/\.(css|ttf|otf|jpg|jpeg|png)$/.test(target)) { console.log('  ERR link target missing in', rel, '->', h); err++; }
          continue;
        }
        if (frag) {
          const ids = await idsOf(target);
          if (ids && !ids.has(frag)) { console.log('  ERR broken fragment', rel, '->', h); err++; }
        }
      }
    }
    // check nav, ncx-equivalent links live in toc.xhtml; also sample surah files
    await checkLinks('toc.xhtml');
    for (const s of ['text/surah-001.xhtml', 'text/surah-009.xhtml', 'text/surah-114.xhtml']) await checkLinks(s);

    // 5) ncx internal links
    const ncx = await z.file('OEBPS/toc.ncx').async('string');
    const ncxSrcs = [...ncx.matchAll(/<content\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    for (const h of ncxSrcs) {
      const [p, frag] = h.split('#');
      const target = resolveHref('', p);
      if (!names.includes('OEBPS/' + target)) { console.log('  ERR ncx -> missing', h); err++; continue; }
      if (frag) { const ids = await idsOf(target); if (ids && !ids.has(frag)) { console.log('  ERR ncx broken fragment', h); err++; } }
    }

    console.log(`  manifest:${man.length} spine:${spine.length} resources:${names.length} ncx-points:${ncxSrcs.length}`);
    console.log('  >>> HARD ERRORS:', err);
    grandErr += err;
  }
  console.log('\n==== TOTAL HARD ERRORS:', grandErr, '====');
  process.exit(grandErr ? 1 : 0);
})();
