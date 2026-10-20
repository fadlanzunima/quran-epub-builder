#!/usr/bin/env node
/* =============================================================================
 *  build-juzamma.js — generate clean XHTML for every Juz 'Amma surah (78–114).
 *
 *  Each file: IndoPak Arabic (text_indopak) + LPMQ/Kemenag transliteration +
 *  Kemenag (Indonesian Islamic Affairs Ministry) translation with footnotes.
 *
 *  Data sources:
 *    - Arabic   : local cache  .cache/verses_{id}_text_indopak_none_p1.json
 *    - Translit : juzamma-translit.json  (hand-authored, LPMQ style)
 *    - Terjemah : quranenc.com  indonesian_affairs  (cached to .cache)
 *    - Metadata : .cache/chapters_id.json
 *
 *  Output: build/surah-0XX.xhtml   (well-formed XHTML, passes validate.js)
 *  Usage : node build-juzamma.js [startId] [endId]
 * ===========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DOMParser } = require('@xmldom/xmldom');

const ROOT = __dirname;
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'build');
const START = Number(process.argv[2]) || 78;
const END = Number(process.argv[3]) || 114;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toAr = n => String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const pad = n => String(n).padStart(3, '0');
const BISM = '&#1576;&#1616;&#1587;&#1618;&#1605;&#1616; &#1649;&#1604;&#1604;&#1617;&#1614;&#1607;&#1616; &#1649;&#1604;&#1585;&#1617;&#1614;&#1581;&#1618;&#1605;&#1614;&#1648;&#1606;&#1616; &#1649;&#1604;&#1585;&#1617;&#1614;&#1581;&#1616;&#1610;&#1605;&#1616;';

const chapters = (() => {
  const c = require(path.join(CACHE, 'chapters_id.json'));
  const list = c.chapters || c;
  const m = new Map();
  for (const x of list) m.set(x.id, x);
  return m;
})();

const translitAll = require(path.join(ROOT, 'juzamma-translit.json'));

async function getKemenag(id) {
  const cf = path.join(CACHE, `quranenc_affairs_${id}.json`);
  if (fs.existsSync(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  const r = await axios.get(`https://quranenc.com/api/v1/translation/sura/indonesian_affairs/${id}`,
    { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const rows = r.data.result;
  fs.writeFileSync(cf, JSON.stringify(rows));
  return rows;
}

function arabicFor(id) {
  const f = path.join(CACHE, `verses_${id}_text_indopak_none_p1.json`);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const verses = data.verses || data;
  return verses.map(v => v.text_indopak.trim());
}

function buildSurah(id) {
  const meta = chapters.get(id);
  const arabic = arabicFor(id);
  const translit = translitAll[String(id)] || [];
  return getKemenag(id).then(rows => {
    const count = meta.verses_count;
    if (arabic.length !== count) throw new Error(`surah ${id}: arabic ${arabic.length} != ${count}`);
    if (translit.length !== count) throw new Error(`surah ${id}: translit ${translit.length} != ${count}`);
    if (rows.length !== count) throw new Error(`surah ${id}: translation ${rows.length} != ${count}`);

    // Footnotes: sequential per-surah numbering from [NNN] markers.
    const notes = [];
    const srcToSeq = new Map();
    for (const row of rows) {
      const fn = (row.footnotes || '').trim();
      if (!fn) continue;
      const m = fn.match(/^\[(\d+)\]\.?\s*(.*)$/s);
      if (!m) continue;
      const seq = notes.length + 1;
      srcToSeq.set(m[1], seq);
      notes.push({ seq, text: m[2].replace(/\s+/g, ' ').trim() });
    }
    const translations = rows.map(row => {
      let t = esc(row.translation.replace(/\s+/g, ' ').trim());
      t = t.replace(/\[(\d+)\]/g, (w, num) => {
        const seq = srcToSeq.get(num);
        return seq ? `<sup class="penanda-footnote"><a epub:type="noteref" id="ref-${id}-${seq}" href="#fn-${id}-${seq}">${seq}</a></sup>` : '';
      });
      return t;
    });

    const place = meta.revelation_place === 'makkah' ? 'Makkiyah' : 'Madaniyah';
    const title = `Surah ${meta.name_simple}`;

    let body = '';
    for (let i = 0; i < count; i++) {
      body += `      <p dir="rtl" lang="ar" class="teks-arab">${esc(arabic[i])} <span class="nomor-ayat">${toAr(i + 1)}</span></p>\n`;
      body += `      <p class="teks-latin">${esc(translit[i])}</p>\n`;
      body += `      <p class="teks-terjemahan">${translations[i]}</p>\n`;
      if (i < count - 1) body += `      <hr class="garis-ayat"/>\n`;
    }

    let notesBlock = '';
    if (notes.length) {
      notesBlock += '\n    <section class="daftar-footnote" epub:type="endnotes" role="doc-endnotes">\n';
      notesBlock += '      <h2 class="judul-footnote">Catatan Kaki</h2>\n';
      for (const n of notes) {
        notesBlock += `      <aside epub:type="footnote" id="fn-${id}-${n.seq}" class="footnote">\n`;
        notesBlock += `        <p class="isi-footnote"><a class="nomor-footnote" epub:type="backlink" href="#ref-${id}-${n.seq}">${n.seq}.</a> ${esc(n.text)}</p>\n`;
        notesBlock += `      </aside>\n`;
      }
      notesBlock += '    </section>\n';
    }

    // At-Taubah (9) is the only surah without basmalah; all Juz 'Amma surahs have it.
    const x =
`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      lang="id" xml:lang="id">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" type="text/css" href="../styles/style.css"/>
</head>
<body>
  <section class="surah" epub:type="chapter" role="doc-chapter"
           id="surah-${id}" aria-label="${esc(title)}">
    <header class="header-surah">
      <h1 class="judul-surah" lang="ar" xml:lang="ar" dir="rtl">${esc(meta.name_arabic)}</h1>
      <p class="nama-latin">${esc(title)} &#183; ${esc(meta.translated_name.name)}</p>
      <h2 class="info-surah">Surah ke-${id} &#183; ${place} &#183; ${count} Ayat</h2>
    </header>

    <p dir="rtl" lang="ar" class="basmalah">${BISM}</p>

    <div class="daftar-ayat">
${body}    </div>
${notesBlock}  </section>
</body>
</html>
`;

    // Validate well-formedness + fragment resolution
    let ok = true; const errs = [];
    const doc = new DOMParser({ onError: (l, m) => { if (l !== 'warning') { ok = false; errs.push(l + ': ' + m); } } })
      .parseFromString(x, 'application/xhtml+xml');
    if (!ok) throw new Error(`surah ${id} not well-formed: ${errs.join('; ')}`);
    const ids = new Set();
    for (const el of Array.from(doc.getElementsByTagName('*'))) { const i = el.getAttribute('id'); if (i) ids.add(i); }
    const frags = [...x.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
    const missing = frags.filter(f => !ids.has(f));
    if (missing.length) throw new Error(`surah ${id} dangling fragments: ${missing.join(',')}`);

    fs.writeFileSync(path.join(OUT, `surah-${pad(id)}.xhtml`), x);
    return { id, name: meta.name_simple, count, notes: notes.length };
  });
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const results = [];
  for (let id = START; id <= END; id++) {
    try { results.push(await buildSurah(id)); process.stdout.write('.'); }
    catch (e) { console.log(`\n✗ ${e.message}`); process.exitCode = 1; }
  }
  console.log('\n');
  for (const r of results) console.log(`  ✅ surah-${pad(r.id)}  ${r.name.padEnd(14)} ${String(r.count).padStart(3)} ayat, ${r.notes} footnote`);
  console.log(`\n${results.length}/${END - START + 1} surah generated.`);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
