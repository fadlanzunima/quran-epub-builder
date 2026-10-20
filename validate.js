/* =============================================================================
 * validate.js — pure-Node EPUB 3 sanity checker (no Java / no EPUBCheck needed)
 * Covers the structural rules EPUBCheck enforces most often:
 *   - OCF: mimetype present, first, stored, exact content
 *   - META-INF/container.xml → OPF rootfile resolves
 *   - OPF/NCX/XHTML are well-formed XML
 *   - every manifest href exists in the archive; spine idrefs resolve
 *   - nav.xhtml has toc + landmarks; ncx referenced
 *   - every internal link + #fragment (incl. juz anchors) resolves
 *   - media-types present; no remote (http) resource references
 *
 * Usage: node validate.js [path-to-epub ...]   (defaults to both dist files)
 * NOTE: this is a strong pre-flight, not a substitute for official EPUBCheck.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const files = process.argv.slice(2);
const DEFAULTS = [
  'dist/Al-Quran (Uthmani Format).epub',
  'dist/Al-Quran (IndoPak Format).epub'
];

function parseXml(name, text, errors) {
  let ok = true;
  const parser = new DOMParser({
    onError: (level, msg) => { if (level === 'error' || level === 'fatalError') { ok = false; errors.push(`XML ${level} in ${name}: ${String(msg).trim()}`); } },
    locator: {}
  });
  let doc = null;
  try { doc = parser.parseFromString(text, 'application/xhtml+xml'); }
  catch (e) { ok = false; errors.push(`XML exception in ${name}: ${e.message}`); }
  return ok ? doc : null;
}

const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const normalize = p => {
  const parts = []; for (const seg of p.split('/')) { if (seg === '.' || seg === '') continue; if (seg === '..') parts.pop(); else parts.push(seg); } return parts.join('/');
};

async function validate(buf) {
  const errors = [], warnings = [], info = [];

  // 1) mimetype: first entry, stored, exact content
  const at30 = buf.slice(30, 38).toString('latin1');
  if (at30 !== 'mimetype') errors.push(`'mimetype' is not the first archive entry (found "${at30}")`);
  const zip = await JSZip.loadAsync(buf);
  const mt = zip.file('mimetype');
  if (!mt) errors.push('mimetype entry missing');
  else {
    const c = (await mt.async('string')).replace(/\n$/, '');
    if (c !== 'application/epub+zip') errors.push(`mimetype content wrong: "${c}"`);
    const magic = mt._data && mt._data.compression && mt._data.compression.magic;
    if (magic !== '\x00\x00') errors.push('mimetype is compressed (must be STORED)');
  }

  const names = new Set(Object.keys(zip.files).filter(n => !zip.files[n].dir));

  // 2) container.xml → OPF
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) { errors.push('META-INF/container.xml missing'); return done(); }
  const containerXml = await containerFile.async('string');
  parseXml('container.xml', containerXml, errors);
  const rootMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootMatch) { errors.push('container.xml has no rootfile full-path'); return done(); }
  const opfPath = rootMatch[1];
  if (!names.has(opfPath)) { errors.push(`OPF not found at ${opfPath}`); return done(); }
  const opfDir = dirname(opfPath);

  // 3) OPF well-formed + metadata + manifest + spine
  const opfXml = await zip.file(opfPath).async('string');
  const opfDoc = parseXml(opfPath, opfXml, errors);
  for (const req of ['dc:identifier', 'dc:title', 'dc:language']) {
    if (!new RegExp(`<${req}[ >]`).test(opfXml)) errors.push(`OPF missing <${req}>`);
  }
  if (!/dcterms:modified/.test(opfXml)) warnings.push('OPF missing dcterms:modified (EPUB3 requires it)');

  // manifest items
  const manifest = new Map(); // id -> {href, type, props}
  const hrefToId = new Map();
  if (opfDoc) {
    for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
      const id = item.getAttribute('id'), href = item.getAttribute('href'), type = item.getAttribute('media-type');
      const props = item.getAttribute('properties') || '';
      if (!id || !href) { errors.push(`manifest item missing id/href`); continue; }
      if (!type) errors.push(`manifest item ${id} missing media-type`);
      const abs = normalize(opfDir + href);
      manifest.set(id, { href, abs, type, props });
      hrefToId.set(abs, id);
      if (!names.has(abs)) errors.push(`manifest href not in archive: ${href} (${abs})`);
    }
  }
  const navItems = [...manifest.values()].filter(m => /\bnav\b/.test(m.props));
  if (navItems.length !== 1) errors.push(`expected exactly one manifest item with properties="nav", found ${navItems.length}`);
  const coverImgs = [...manifest.values()].filter(m => /cover-image/.test(m.props));
  if (coverImgs.length === 0) warnings.push('no item with properties="cover-image"');

  // spine
  const spineRefs = opfDoc ? Array.from(opfDoc.getElementsByTagName('itemref')) : [];
  if (spineRefs.length === 0) errors.push('spine has no itemref');
  let ncxId = null;
  const spineEl = opfDoc && opfDoc.getElementsByTagName('spine')[0];
  if (spineEl) ncxId = spineEl.getAttribute('toc');
  for (const ir of spineRefs) {
    const idref = ir.getAttribute('idref');
    if (!manifest.has(idref)) errors.push(`spine itemref idref not in manifest: ${idref}`);
  }
  if (ncxId && !manifest.has(ncxId)) errors.push(`spine toc="${ncxId}" not in manifest`);

  // 4) collect all ids per XHTML for fragment resolution; well-formedness
  const idsByFile = new Map(); // abs -> Set(ids)
  const xhtmlFiles = [...manifest.values()].filter(m => m.type === 'application/xhtml+xml');
  for (const m of xhtmlFiles) {
    if (!names.has(m.abs)) continue;
    const text = await zip.file(m.abs).async('string');
    const doc = parseXml(m.abs, text, errors);
    const ids = new Set();
    if (doc) for (const el of Array.from(doc.getElementsByTagName('*'))) { const id = el.getAttribute('id'); if (id) ids.add(id); }
    idsByFile.set(m.abs, ids);
    // remote resources
    const remote = text.match(/(?:src|href)="https?:\/\/[^"]+"/g);
    if (remote) warnings.push(`${m.href}: ${remote.length} remote resource ref(s) (e-readers may block)`);
  }

  // NCX well-formed
  if (ncxId && manifest.get(ncxId) && names.has(manifest.get(ncxId).abs)) {
    parseXml(manifest.get(ncxId).abs, await zip.file(manifest.get(ncxId).abs).async('string'), errors);
  }

  // 5) nav.xhtml has toc + landmarks; resolve its links & fragments
  if (navItems.length === 1) {
    const navAbs = navItems[0].abs;
    const navText = await zip.file(navAbs).async('string');
    if (!/epub:type="toc"/.test(navText)) errors.push('nav.xhtml has no epub:type="toc"');
    if (!/epub:type="landmarks"/.test(navText)) warnings.push('nav.xhtml has no landmarks nav');
    checkLinks(navAbs, navText);
  }

  // 6) resolve internal links + fragments across every XHTML
  for (const m of xhtmlFiles) {
    if (!names.has(m.abs)) continue;
    checkLinks(m.abs, await zip.file(m.abs).async('string'));
  }

  function checkLinks(fromAbs, text) {
    const fromDir = dirname(fromAbs);
    const hrefs = [...text.matchAll(/(?:href|src)="([^"]+)"/g)].map(x => x[1]);
    for (const h of hrefs) {
      if (/^(https?:|mailto:|data:|#)/.test(h) && h[0] !== '#') continue;
      let target = h, frag = null;
      const hashI = h.indexOf('#');
      if (hashI >= 0) { frag = h.slice(hashI + 1); target = h.slice(0, hashI); }
      const abs = target === '' ? fromAbs : normalize(fromDir + target);
      if (target !== '' && !names.has(abs)) { errors.push(`${path.basename(fromAbs)}: link target missing: ${h}`); continue; }
      if (frag) {
        const ids = idsByFile.get(abs);
        if (ids && !ids.has(frag)) errors.push(`${path.basename(fromAbs)}: fragment #${frag} not found in ${target || path.basename(fromAbs)}`);
      }
    }
  }

  function done() {
    return { errors, warnings, info };
  }
  return done();
}

/** Validate an in-memory EPUB buffer. Returns { errors, warnings, info }. */
async function validateEpubBuffer(buf) { return validate(buf); }
/** Validate an EPUB file on disk. */
async function validateEpubFile(p) { return validate(fs.readFileSync(p)); }

module.exports = { validateEpubBuffer, validateEpubFile };

/* CLI mode: node validate.js [file ...] */
if (require.main === module) {
  (async () => {
    const targets = (files.length ? files : DEFAULTS).map(f => path.isAbsolute(f) ? f : path.join(__dirname, f));
    let totalErr = 0;
    for (const t of targets) {
      if (!fs.existsSync(t)) { console.log(`\n✗ ${t} — not found`); totalErr++; continue; }
      const { errors, warnings } = await validateEpubFile(t);
      const base = path.basename(t);
      console.log(`\n${'='.repeat(60)}\n${base}\n${'='.repeat(60)}`);
      if (errors.length === 0) console.log('  ✅ 0 errors');
      else { console.log(`  ❌ ${errors.length} error(s):`); errors.slice(0, 40).forEach(e => console.log('    - ' + e)); }
      if (warnings.length) { console.log(`  ⚠  ${warnings.length} warning(s):`); warnings.slice(0, 20).forEach(w => console.log('    - ' + w)); }
      totalErr += errors.length;
    }
    console.log(`\n${totalErr === 0 ? '✅ ALL CLEAN' : '❌ ' + totalErr + ' total error(s)'}`);
    process.exit(totalErr === 0 ? 0 : 1);
  })().catch(e => { console.error('validator crashed:', e); process.exit(2); });
}
