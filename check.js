#!/usr/bin/env node
/* =============================================================================
 *  check.js — validate built EPUBs with a LOCAL epubcheck jar.
 *
 *  Usage:
 *    node check.js                         # validate everything in dist/
 *    node check.js dist/quran_english_uthmani.epub   # validate one file
 *    npm run check | check:id | check:en
 *
 *  Requirements:
 *    - Java (JRE/JDK) on PATH            ->  `java -version`
 *    - epubcheck.jar placed in ./tools/  ->  download from
 *      https://github.com/w3c/epubcheck/releases  (grab epubcheck-x.y.z.zip,
 *      unzip, copy epubcheck.jar into tools/). Or set EPUBCHECK_JAR env var.
 * ===========================================================================*/

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

/* --- locate the jar ------------------------------------------------------ */
function findJar() {
  if (process.env.EPUBCHECK_JAR && fs.existsSync(process.env.EPUBCHECK_JAR)) {
    return process.env.EPUBCHECK_JAR;
  }
  const toolsDir = path.join(ROOT, 'tools');
  const candidates = [path.join(toolsDir, 'epubcheck.jar')];
  if (fs.existsSync(toolsDir)) {
    for (const f of fs.readdirSync(toolsDir)) {
      if (/^epubcheck.*\.jar$/i.test(f)) candidates.push(path.join(toolsDir, f));
    }
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

/* --- java present? ------------------------------------------------------- */
function hasJava() {
  const r = spawnSync('java', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

/* --- collect target files ------------------------------------------------ */
function targets() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) return args;
  if (!fs.existsSync(DIST)) return [];
  return fs
    .readdirSync(DIST)
    .filter((f) => f.toLowerCase().endsWith('.epub'))
    .map((f) => path.join(DIST, f));
}

/* --- main ---------------------------------------------------------------- */
function main() {
  const files = targets();
  if (files.length === 0) {
    console.error('No .epub files found. Build first:  npm run build');
    process.exit(1);
  }

  if (!hasJava()) {
    console.error('Java not found on PATH. Install a JRE and retry (epubcheck needs Java).');
    process.exit(1);
  }

  const jar = findJar();
  if (!jar) {
    console.error(
      'epubcheck.jar not found.\n' +
        '  -> Download from https://github.com/w3c/epubcheck/releases\n' +
        '  -> Unzip and copy epubcheck.jar into ./tools/  (or set EPUBCHECK_JAR)'
    );
    process.exit(1);
  }

  console.log(`Using: ${path.relative(ROOT, jar)}\n`);

  let failures = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`  ! missing: ${file}`);
      failures += 1;
      continue;
    }
    console.log(`=== epubcheck: ${path.relative(ROOT, file)} ===`);
    const r = spawnSync('java', ['-jar', jar, file], { stdio: 'inherit' });
    if (r.status !== 0) failures += 1;
    console.log('');
  }

  if (failures) {
    console.error(`${failures} file(s) failed validation.`);
    process.exit(1);
  }
  console.log('All EPUBs passed epubcheck. ✔');
}

main();
