# Quran EPUB Builder — Mushaf Edition

Generates **two** polished, book-styled EPUB 3 files from the [quran.com API v4](https://quran.com/api):

| Edition | Output file | Content | Script | Font |
|---|---|---|---|---|
| 1 · Uthmani | `Al-Quran_Arab_Only_Uthmani.epub` | Pure Arabic, continuous Mushaf flow | Uthmani (`text_uthmani`) | KFGQPC Uthmanic Hafs → *Amiri Quran* fallback |
| 2 · IndoPak | `Al-Quran_Arab_Only_IndoPak.epub` | Pure Arabic, continuous Mushaf flow | IndoPak (`text_indopak`) | your IndoPak font → *Scheherazade New* fallback |

Both are **Arabic-only (no translation)** and differ only in script style. They target **monochrome e-ink** (Kindle Paperwhite, Kobo Clara, Onyx Boox, Meebook) and **color tablets** (iPad, Fire, Android) with a lightweight **pure-CSS** ornamental frame, bordered surah header banners, auto-sizing ayah-end medallions, Eastern-Arabic numerals (`١ ٢ ٣`), full Juz→Surah navigation, and dark-mode support.

> **E-ink safety:** decoration is pure CSS only — **no SVG `border-image`/backgrounds and no `box-shadow`**. Those stall/hang low-power e-readers on long surahs (e.g. Al-Baqarah), so they are deliberately avoided.

---

## 1. Install & run

```bash
cd quran-epub-builder
npm install            # axios + jszip
node builder.js        # builds BOTH editions into ./dist
```

Other modes:

```bash
node builder.js --only=arab       # Uthmani edition only
node builder.js --only=indopak    # IndoPak edition only
node builder.js --offline         # rebuild from cached API data in ./.cache (no network)
```

Output:

```
dist/
├── Al-Quran_Arab_Only_Uthmani.epub
└── Al-Quran_Arab_Only_IndoPak.epub
```

The first run caches all API responses under `.cache/`, so re-builds are fast and offline-capable.

---

## 2. Before you build (optional but recommended)

1. **Cover** — save your ornate cover as `assets/cover.jpg`. If absent, a generated text cover is used (build still succeeds).
2. **Fonts** — the builder **auto-downloads** OFL fallbacks (Amiri Quran for Uthmani, Scheherazade New for IndoPak). To use your own fonts, drop `UthmanicHafs.ttf` (Uthmani) and/or an IndoPak font — e.g. `me_quran.ttf`, `AlQalam.ttf`, `PDMS_Saleem_QuranFont.ttf`, `NotoNastaliqUrdu-Regular.ttf` — into `fonts/` (or `assets/fonts/`). They are preferred automatically. See `fonts/README.txt`.

---

## 3. Project layout

```
quran-epub-builder/
├── builder.js            # fetch → generate → zip → export (the whole pipeline)
├── package.json
├── templates/
│   ├── style.css         # single source of truth for CSS (builder reads this)
│   ├── content.opf       # reference manifest template
│   ├── toc.xhtml         # reference EPUB3 nav template
│   └── toc.ncx           # reference legacy NCX template
├── assets/   (cover.jpg) # SVG ornaments are generated at build time
├── fonts/    (*.ttf/otf) # your fonts or auto-downloaded fallbacks
├── .cache/               # cached API JSON (created on first run)
└── dist/                 # ← the two .epub files land here
```

Generated EPUB internals (per edition):

```
mimetype  (stored, uncompressed, first entry)
META-INF/container.xml
OEBPS/
├── content.opf · nav.xhtml · toc.ncx · cover.xhtml
├── css/style.css
├── fonts/<embedded font>
├── images/ cover.jpg   (decoration is pure CSS — no ornament images)
└── text/ surah-001.xhtml … surah-114.xhtml
```

---

## 4. How the key requirements are met

- **Book aesthetic** — each surah section is wrapped in `.page` with a pure-CSS double-rule frame (bingkai) that scales to any screen width without overflow; a bordered cartouche banner for each surah title; a bordered medallion around each ayah number. No images are used for decoration (e-ink safe).
- **Eastern-Arabic numerals** — `num.toString().replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d])` is used for every in-text ayah number and juz label.
- **Navigation & progress bars** — nested `<ol>` in `nav.xhtml` (Juz 1–30 → Surah) plus a matching `toc.ncx`, and an `epub:type="landmarks"` nav with `cover` / `toc` / `bodymatter`. This is what Kindle & Kobo use for chapter progress bars and reading percentage. Juz links target exact `#ayah-{surah}-{verse}` anchors (so mid-surah juz starts land correctly).
- **Dark mode** — `@media (prefers-color-scheme: dark)` swaps to light-stroke ornaments + dark paper on color apps, while e-ink keeps pure `#000` on `#fff`.
- **Send-to-Kindle fonts** — valid `@font-face` pointing to `OEBPS/fonts/`, and OPF MIME types `application/font-sfnt` (.ttf) / `application/vnd.ms-opentype` (.otf) so Amazon's converter keeps the embedded font.

---

## 5. Validation (automatic)

**Every build auto-validates.** After each `.epub` is written, `builder.js` runs the
built-in pure-Node validator (`validate.js`, no Java needed) and prints a clear
PASS/FAIL summary. If any file fails, the build exits non-zero and the file is
flagged *not safe to upload*:

```
┌──────────────────────────────────────────────────────────┐
│ BUILD SUMMARY                                             │
├──────────────────────────────────────────────────────────┤
│ PASS ✅  Al-Quran_Arab_Only_Uthmani.epub        3.80 MB  │
│ PASS ✅  Al-Quran_Arab_Only_IndoPak.epub        3.86 MB  │
└──────────────────────────────────────────────────────────┘
```

The validator checks: OCF/`mimetype` (first + STORED), `container.xml`→OPF, XML
well-formedness of every OPF/NCX/XHTML, all manifest hrefs exist, spine idrefs
resolve, `nav`+`landmarks`, every internal link and `#fragment` (incl. juz
anchors), media-types, and absence of remote resources.

Run it standalone any time:

```bash
npm run validate                       # both dist files
node validate.js dist/some.epub        # a specific file
```

Optional — the official W3C EPUBCheck (needs Java): `npm i -g epubcheck && npm run check`.
Also preview in **Thorium Reader**, **Apple Books**, or **Calibre** before shipping.

---

## 6. Upload via Amazon "Send to Kindle"

1. Go to **<https://www.amazon.com/sendtokindle>** (or use the Send to Kindle desktop app / email-to-Kindle address).
2. Sign in, **drag in** `Al-Quran_Arab_Only_Uthmani.epub` (and/or the IndoPak file).
3. Set *Document type* = **Book** so it appears in your Library with full chapter navigation.
4. Choose the target device/app → **Send**. Amazon converts EPUB→KFX in the cloud; the embedded font and nested TOC are preserved because of the valid `@font-face` + correct MIME types.
5. On device, open the book → the Juz/Surah menu and progress bar appear automatically.

> Tip: if Arabic shows in a system font instead of the embedded one, confirm the font file is actually in `fonts/` (check the build log line `✓ embedding font: …`) and that your reader has "Publisher Font" / "Original" enabled.

---

## 7. Important notes & honest limitations

- **Per-page borders**: a true border around *every rendered screen page* is **not possible in reflowable EPUB** (the reader repaginates dynamically). This build frames each **surah section** — the reflow-safe equivalent that preserves font scaling, dark mode, and progress tracking. A per-page frame would require fixed-layout EPUB, which breaks those features.
- **Both editions are Arabic-only** and differ only by script (`text_uthmani` vs `text_indopak`). To re-add a translated edition later, set `bilingual:true`, an `arabicField`, and a `translationId` on a new entry in `EDITIONS`.
- **Licensing**: Quran text is public domain. KFGQPC and most IndoPak Quran fonts (me_quran, AlQalam, PDMS Saleem) have redistribution restrictions — verify rights before publishing publicly. The auto-downloaded Amiri Quran & Scheherazade New are OFL (safe to redistribute).
