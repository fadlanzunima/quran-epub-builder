# Changelog

Catatan perubahan yang **sudah diverifikasi benar** (render dicek, bukan sekadar diedit).
Format tanggal: YYYY-MM-DD.

---

## 2026-11-26 (lanjutan) — Kobo Clara: fix judul, margin, + versi teks (highlight)

### Fixed — judul buku jadi "114. An-Nas" (bukan "Al-Qur'an al-Karim")
- **Masalah:** di Kobo nama buku muncul **"114. An-Nas"**. Penyebab: di
  `build-clara-image-epub.py`, loop TOC `for lvl, title, pg in doc.get_toc()`
  **menimpa** parameter `title`, sehingga `dc:title`/`docTitle` memakai entri outline
  TERAKHIR (114. An-Nas), bukan judul buku.
- **Perbaikan:** ganti nama variabel loop (`ttl`), parameter `title` tak lagi tertimpa.
- **Verifikasi:** `dc:title` & `docTitle` = "Al-Qur'an al-Karim"; TOC tetap 114.

### Changed — margin versi Gambar dikecilkan (4mm → 2.5mm)
- Profil `clara` di [build-xteink-pdf.js](build-xteink-pdf.js): `marginMm`/`marginVMm`
  4.0→**2.5**. Teks lebih lega/penuh, penanda halaman mushaf duduk lebih dekat tepi.
- **Hasil:** PDF 1293→**1193 hlm** (lebih padat), EPUB gambar **57,9 MB**. Render page 3
  Al-Baqarah: teks penuh, nomor halaman ٢ di tepi bawah, Arab tersambung.
- **Catatan:** desainnya *continuous-flow*, jadi "nomor halaman" = penanda halaman
  mushaf asli (604) yang ikut mengalir — tak selalu persis di tepi tiap layar.

### Added — versi TEKS (reflow) Amiri Quran untuk highlight/anotasi
- **Kenapa:** versi Gambar = foto halaman (0 teks) → highlight/anotasi/cari-kata
  MUSTAHIL. Untuk fitur itu perlu teks asli. LPMQ/Uthmani putus di Clara, tapi
  **Amiri Quran** terkonfirmasi render benar (lihat [[kobo-clara-arabic-rendering]]).
- **Build:** `npm run build:clara-text` → `build-kobo-clara-epub.py` ambil
  `Al-Quran.epub` (reflow, embed ScheherazadeNew sbg family `QuranArabic`), **swap
  file font → AmiriQuran-Regular.ttf** (family tetap, glyph jadi Amiri), tambah
  `<guide>` + cover-meta, buang DRM, mimetype stored.
- **Output:** `dist/Al-Quran/epub/Kobo-Clara/Al-Quran Kobo Clara (Teks).epub` — **3,9 MB**,
  hanya font Amiri, **teks Arab bisa diseleksi** (32 kata di Al-Fatihah) → highlight/
  anotasi/cari jalan. Trade-off: gaya font bukan LPMQ mushaf, tanpa layout halaman baked.
- **Caveat:** per [[clara-kepub-amiri-quran]] kepub reflow Al-Quran historis kadang
  **tak mau import** di Clara (blocker belum pasti) — **wajib uji di device**; versi
  Gambar tetap fallback andal.

### Dua deliverable Kobo Clara (pilih sesuai kebutuhan)
- **Gambar** `...(Gambar).epub` — baca mushaf LPMQ persis, full-bleed, nomor halaman mushaf. Tanpa highlight.
- **Teks** `...(Teks).epub` — Amiri Quran, bisa highlight/anotasi/cari. Tanpa layout mushaf baked.

---

## 2026-11-26 — Al-Quran Kobo Clara (EPUB gambar dari PDF)

### Fixed — halaman ter-zoom & terpotong di perangkat (hanya pojok kiri-atas tampil)
- **Masalah:** tiap halaman di- set ukuran **piksel absolut** (`<img>`/`body`
  `width:1072px;height:1452px`). Saat Clara TIDAK merender sebagai fixed-layout
  murni (mis. EPUB belum di-kepubify, atau firmware fallback ke reflow), 1072 CSS-px
  jauh lebih lebar dari panel logis (~750 px) → gambar meluber, yang terlihat cuma
  **pojok kiri-atas yang membesar** (persis screenshot user: cover ter-zoom/terpotong).
- **Perbaikan:** tiap gambar kini dibungkus **SVG** ber-`viewBox="0 0 W H"` +
  `preserveAspectRatio="xMidYMid meet"` di `page_xhtml()`
  [build-clara-image-epub.py](build-clara-image-epub.py); `svg{width:100%;height:100%}`.
  "meet" selalu **fit-to-screen** (contain, di tengah, tak pernah meluber) di SEMUA
  reader — baik fixed-layout dihormati maupun fallback reflow. `IMG_W/IMG_H` kini
  diambil dari ukuran piksel PNG asli (1072×1452), jadi viewBox == viewport == gambar.
- **Verifikasi:** render ulang (1293 hlm); viewport `(1072,1452)` == viewBox, SVG
  100%×100%, `preserveAspectRatio` meet ada. Aspek gambar (0.738) ≈ aspek layar Clara
  (0.74) → terisi penuh. Struktur tetap: fixed-layout, `<guide>`, cover-meta, 0 DRM,
  mimetype stored, 114 TOC.

### Changed — ukuran file dikecilkan (89 MB → 58 MB) via palet 4-warna
- **Masalah:** EPUB gambar ~89 MB (jadi ~98 MB setelah kepubify) — palet PNG 16-warna
  mubazir karena halaman Clara = **teks hitam di atas putih** (profil `clara`
  memakai `background:#fff;color:#000`, bukan krem/hijau seperti buku lain).
- **Perbaikan:** render PNG dengan **4 warna** (`colors=4`) — argumen keenam
  `build-clara-image-epub.py`; npm `build:clara-image` kini memanggil `... 0 1072 4`.
  4 aras abu masih memberi anti-alias pada tepi huruf & harakat.
- **Hasil:** `dist/Al-Quran/epub/Kobo-Clara/Al-Quran Kobo Clara (Gambar).epub`
  **58,4 MB** (dari 89,1 MB, ~34% lebih kecil); perkiraan kepub ~62-65 MB (dari 98 MB).
- **Verifikasi render:** page 3 Al-Baqarah 4-warna — huruf, harakat, dan nomor ayat
  berlian tetap tajam, tanpa penurunan kualitas yang terlihat. Struktur utuh: cover
  `slice`, isi `meet`, fixed-layout, `<guide>`, cover-meta, 0 DRM, 1293 gambar, 114 TOC.
  (Catatan: default skrip tetap 16-warna untuk buku krem/hijau — Juz 'Amma/Dzikir;
  hanya Al-Quran Clara yang hitam-putih sehingga aman di 4-warna.)

### Changed — cover dibuat full-page (full-bleed)
- **Permintaan:** cover mengisi penuh layar, bukan fit dengan pinggiran putih.
- **Perbaikan:** halaman cover (pg1) kini `preserveAspectRatio="xMidYMid slice"`
  (mengisi penuh viewport, crop kelebihan) di [build-clara-image-epub.py](build-clara-image-epub.py);
  halaman isi tetap `meet` agar tak ada ayat terpotong. Karena aspek cover (0.738) ≈
  layar Clara (0.74), crop hanya ~4 px (border ornamen punya ruang sisa).
- **Verifikasi:** pg1 = `slice`, pg2 = `meet` (dikonfirmasi dari XHTML hasil build).

### Added — profil device `clara` di build-xteink-pdf.js
- **Tujuan:** Kobo Clara reflow-shape Arab sendiri → LPMQ/Scheherazade putus
  (lihat [[kobo-clara-arabic-rendering]]). Solusi = bake glyph ke PDF lalu bungkus
  tiap halaman sebagai gambar (sama ide dengan .xtc Xteink). Agar PDF Clara lewat
  **pipeline karakter yang IDENTIK X4** (keheh→kaf di sumber, `foldSpaces` EN/EM,
  `tightenAyahNumbers`, `text-align:right` anti-kashida, font page-num Scheherazade,
  outline 114 surah), ditambahkan profil `clara` ke [build-xteink-pdf.js](build-xteink-pdf.js).
- **Ukuran:** 1072×1448 px @ 300 PPI = 90.76×122.61 mm (panel Clara HD/2E/Colour).
  Font sedikit lebih besar dari X4 (arabic 21px, margin 4mm) untuk baris mushaf yang
  penuh-nyaman di layar 6".
- **Jalankan:** `npm run build:clara-pdf` (= `node build-xteink-pdf.js clara`).
- **Hasil:** `dist/Al-Quran/pdf/Kobo-Clara/Al-Quran Kobo Clara.pdf` — **1293 hlm**,
  42 MB, 114 bookmark. (Menggantikan PDF lama Nov-23 yang belum punya fix keheh/justify.)

### Added — EPUB page-image Kobo Clara (ambil dari PDF) + repoint npm script
- **Alur (sesuai permintaan):** PDF baked → EPUB gambar → user kepubify sendiri.
  `build-clara-image-epub.py` membungkus tiap halaman PDF jadi PNG 16-warna, OPF
  fixed-layout (pre-paginated), `<guide>` EPUB2, `<meta name="cover">`, container
  `application/oebps-package+xml`, mimetype stored, TOC 114 surah dari outline PDF.
- **Jalankan:** `npm run build:clara-image` (atau `npm run build:clara` untuk PDF+EPUB).
- **Output (plain .epub, bukan .kepub):** `dist/Al-Quran/epub/Kobo-Clara/Al-Quran Kobo
  Clara (Gambar).epub` — 1293 hlm, 1072×1448 px native, ~89 MB. Validasi: mimetype
  first+stored, container media-type benar, fixed-layout, `<guide>`, cover-meta,
  114 link TOC, 0 file DRM.
- **Verifikasi render (bukan sekadar edit):** page 2 Al-Fatihah, page 3 Al-Baqarah,
  **page 7 Al-Baqarah 2:23 `كُنْتُمْ` tersambung sempurna** (character check lolos —
  keheh sudah dinormalisasi di sumber), cover full-bleed, nomor halaman 3-digit
  **`٦٠٤` satu unit** (An-Nas, tak pecah jadi dua ornamen). Scan sumber:
  0 keheh / 0 dotless-beh / 0 huruf Urdu / 0 PUA.
- **npm:** `build:clara-pdf` di-repoint ke `build-xteink-pdf.js clara` (pipeline
  terverifikasi); `build-clara-pdf.js` lama (layout kotak-tetap, tanpa fix karakter)
  dipindah ke `build:clara-pdf-legacy`.

### Removed — file Kobo lama yang error/usang
- Dihapus dari `dist/Al-Quran/kepub/Kobo/`:
  `Al-Quran (Clara).kepub.epub`, `Al-Quran (Mushaf Kobo).kepub.epub`,
  `Al-Quran.kepub.epub` — ketiganya **reflow kepub** (0 page-image) yang bikin Arab
  putus / tak mau import di Clara. Juga `Al-Quran Kobo Clara (Gambar).kepub.epub`
  (image lama, dibangun dari PDF **X4** beraspek salah) — digantikan EPUB native di atas.

---

## 2026-11-25 — Al-Quran Xteink (X4 / X3)

### Fixed — huruf putus di kata ber-keheh (bug "كُنتُمۡ")
- **Masalah:** teks sumber IndoPak mencampur `ک` (U+06A9 KEHEH, kaf gaya Urdu/Farsi)
  ke dalam kata biasa — **149×** di seluruh Qur'an (mis. Al-Baqarah 2:23 `كُنْتُمْ`).
  Font baked LPMQ tidak punya glyph U+06A9 → Chrome fallback ke font sistem untuk huruf
  itu saja → huruf tampil beda muka **dan putus** dari huruf berikutnya.
- **Perbaikan:** normalisasi `ک`(U+06A9)→`ك`(U+0643) di `normalizeArabic()`
  [builder.js](builder.js) dan `normalizeForLpmq()` [build-juzamma.js](build-juzamma.js).
  Sekaligus varian Urdu langka: `ھ`/`ہ`(U+06BE/U+06C1)→`ه`, `ے`(U+06D2)→`ى`.
- **Verifikasi:** render Al-Baqarah 2:23 dari PDF X4 baru — kedua `كُنْتُمْ`
  tersambung sempurna dalam satu font LPMQ. 0 huruf Urdu nyasar tersisa di EPUB.
- **Catatan:** frasa gambar kedua (2:26 `وَمَا يُضِلُّ بِهٖۤ اِلَّا الْفٰسِقِيْنَ`) TIDAK
  mengandung keheh — ia render bersih di PDF baked; putus-nya berasal dari font firmware
  device (saat melihat EPUB di perangkat). Aturan tetap: **kirim PDF baked, bukan EPUB**.

### Fixed — cover full-bleed (tidak lagi blank / pindah halaman)
- **Masalah:** padding body mendorong `.cover-wrap` (setinggi penuh halaman) sampai
  meluber → gambar cover pindah ke halaman ke-2, menyisakan page 0 blank.
- **Perbaikan:** `.cover-wrap` diberi `margin:-${marginMm}mm` (negative margin) di
  `printCss()` [build-xteink-pdf.js](build-xteink-pdf.js) → cover full-bleed dan pas
  tepat satu halaman, berapa pun nilai margin body.
- **Verifikasi:** page 0 X4 & X3 kini memuat gambar cover (border geometris edge-to-edge);
  page 1 mulai teks.

### Reverted — margin dikembalikan ke semula (spacing ayat)
- **Konteks:** sempat menaikkan margin X4 2.2→2.6mm & X3 2.0→2.4mm untuk memberi
  headroom tanda waqf (ۖ ۚ ۛ) yang menyentuh tepi pada 3 dari 1780 halaman.
- **Alasan revert:** menyempitkan kolom membuat `justify` meregangkan jarak antar-kata
  (spacing ayat jadi terlalu lebar). Overflow waqf itu hanya ~1–2pt (kosmetik) dan
  bug pemotongan parah yang dilaporkan user sudah dibereskan oleh fix keheh di atas.
- **Hasil:** margin kembali **X4 2.2mm / X3 2.0mm**; spacing ayat normal lagi.
  Overflow waqf 3-halaman diterima sebagai known-trivial (tidak terlihat di device).

### Fixed — jarak nomor ayat yang mengambang jauh
- **Masalah:** tiap ayat dibungkus `teks <span class="ayah-num">N</span> ` dengan spasi
  literal (U+0020) di kiri-kanan nomor. `text-align:justify` meregangkan spasi itu
  seperti gap antar-kata → nomor ayat mengambang jauh dari ayatnya.
- **Perbaikan:** `tightenAyahNumbers()` di [build-xteink-pdf.js](build-xteink-pdf.js)
  membuang spasi literal yang menempel pada `.ayah-num`, sehingga jaraknya ditentukan
  oleh `margin` CSS (`.ayah-num{margin:0 .2em}`) yang **tidak ikut meregang**.
- **Verifikasi:** render Al-Baqarah 2:11–2:15 PDF X4 — nomor ⬡١٢/١٣/١٤/١٥ kini rapat
  dengan teksnya. (Gap antar-kata di sebagian baris tetap ada = perilaku justify normal,
  tampilan mushaf.)

### Fixed — huruf putus (بِهِمْ) akibat justify kashida — ROOT CAUSE sebenarnya
- **Masalah:** `.quran-flow{text-align:justify}` membuat Chrome menjustifikasi Arab
  dengan **kashida** — ia meregangkan sambungan *antar-huruf*. Pada font-size kecil
  (17.5px) regangan itu **memutus join**, mis. `بِهِمْ` → `بِ هِمْ`, `بِهٖ` (2:26) putus.
- **Diagnosis:** codepoint EPUB 100% standar (U+0628 U+0650 U+0647 U+0650 U+0645 U+0652);
  render isolasi membuktikan putus HANYA muncul dengan `justify` + ukuran kecil, dan
  HILANG dengan `text-align:right`. (`text-justify:inter-word` tidak menolong — Chrome
  tak mendukung penuh untuk Arab.)
- **Perbaikan:** `.quran-flow` → `text-align:right!important` (hapus justify &
  text-align-last) di [build-xteink-pdf.js](build-xteink-pdf.js).
- **Bonus:** sekaligus menghilangkan gap antar-kata lebar (keluhan "padding jauh").
- **Verifikasi:** render 2:15 PDF X4 — `بِهِمْ`/`وَيَمُدُّهُمْ`/`طُغْيَانِهِمْ` tersambung;
  spasi rapat konsisten.
- **Catatan koreksi:** gambar kedua user (2:26 `بِهٖ`) yang semula dikira "font device"
  TERNYATA bug justify-kashida ini juga.

### Changed — nomor halaman diperjelas, diperbesar, dipertebal
- **Masalah:** base CSS EPUB memberi `.page-num{color:var(--muted)}` (abu-abu) dan print
  CSS tak override → nomor halaman pudar, kecil, tipis.
- **Perbaikan:** `.page-num` → `color:#000` + `font-weight:bold`, ukuran X4 9→12px /
  X3 8.5→11px di [build-xteink-pdf.js](build-xteink-pdf.js).
- **Verifikasi:** nomor halaman mushaf (mis. ٢) kini hitam, lebih besar, tebal, jelas.

### Added — outline/chapter (daftar surah) untuk PDF Xteink
- **Masalah:** `build-xteink-pdf.js` tidak menanamkan PDF outline, jadi daftar chapter
  `.xtcz` **kosong** (konverter resmi Xteink membangun chapter dari outline PDF).
- **Perbaikan:** tiap surah dibungkus `<section id="pdfnav-N">`, ditambah `<nav hidden>`
  berisi link ke tiap id (memicu Chrome memancarkan named destination), lalu
  `add-pdf-outline.py` (PyMuPDF) menempelkan outline — **flat 114 surah**. Judul diambil
  dari `<title>` tiap surah dan entity HTML-nya di-decode (`Ali &#39;Imran` → `Ali 'Imran`).
- **Verifikasi:** `get_toc()` → 114 bookmark, halaman monotonik (1. Al-Fatihah→hlm 2,
  114. An-Nas→hlm 1751 pada X4), judul bersih.

### Fixed — nomor halaman 3-digit pecah jadi dua ornamen
- **Masalah:** ornamen berlian di nomor halaman adalah **glyph ligatur font LPMQ**, dan
  LPMQ hanya punya ligatur ornamen untuk angka **sampai ~286** (jumlah ayat maksimal).
  Nomor halaman mencapai 604, jadi mis. ٦٠٤ **pecah jadi DUA berlian** (٦٠ + ٤).
- **Perbaikan:** nomor halaman tak lagi memakai ornamen font. Di-bake font
  **Scheherazade New** khusus `.page-num` (`@font-face PageNumFont`) → digit Arab polos,
  jelas, **satu tempat**, nol (٠) terlihat benar. Ukuran dinaikkan (X4 12→16, X3 11→15).
  Ayah tetap pakai ornamen LPMQ (angka ≤286, aman).
- **Verifikasi:** render hlm 604 (Scheherazade, satu baris jelas); `get_text` konfirmasi
  nomor 3-digit = satu unit teks di X4 & X3 (tak pecah).

### Fixed — overlap teks di tepi atas/bawah tiap halaman
- **Masalah:** padding vertikal ada di `body`, tapi karena teks mengalir kontinu,
  padding itu hanya berlaku di halaman pertama/terakhir → halaman isi lain teksnya
  menempel/overlap ke tepi atas & bawah.
- **Perbaikan:** margin vertikal dipindah ke `@page{margin:<marginVMm>mm 0}`
  (berlaku di SETIAP halaman); horizontal tetap di `body`. Cover memakai named-page
  `@page cover{margin:0}` + `.cover-wrap{page:cover}` agar tetap full-bleed (tak kena
  margin vertikal, tak jadi halaman kosong). Nilai: X4 3.0mm, X3 2.7mm (diperkecil
  dari 4.0/3.6 atas permintaan — tetap tanpa overlap/terpotong).
- **Verifikasi:** halaman isi kini ada ruang atas/bawah; cover tetap edge-to-edge di
  page 0; tak ada blank page; outline 114 utuh.

### Changed — banner surah: judul Latin seragam + jumlah ayat bold
- **Judul Latin** (`.surah-name-tr`, mis. "Al-Kahf — The Cave .18") dibuat **hitam +
  bold** agar seragam dengan nama Arab (sebelumnya abu `--muted`, normal).
- **Jumlah ayat** di meta ("١١٠ آيات") dibungkus `<strong class="ayah-count">` via
  `styleBanner()` dan dibold (tak termasuk "Makkiyyah").
- Di [build-xteink-pdf.js](build-xteink-pdf.js). Verifikasi: render banner Al-Kahf.

### Changed — jarak nomor halaman ke ayat diperkecil (tidak rapat)
- **Masalah:** nomor halaman mushaf punya gap vertikal besar ke ayat (line-height +
  margin bawaan).
- **Perbaikan:** `.page-num` → `line-height:1` + `margin:.25em 0` (simetris) di
  [build-xteink-pdf.js](build-xteink-pdf.js).
- **Verifikasi:** gap atas/bawah ~6pt (sebelumnya ~30pt+) — rapat tapi tak nempel.

### Fixed — nomor ayat "jauh sendiri" (mis. Al-Kahf 1)
- **Masalah:** sebagian ayat punya **U+2002 (EN SPACE)** / U+2003 (EM SPACE) sebelum
  tanda akhir ayat (mis. "عِوَجًا ⟨EN SPACE⟩ ؕ ①"). Spasi lebar fiksed ini **tidak
  di-collapse** HTML seperti spasi biasa → nomor ayat mengambang jauh dari ayatnya;
  ayat lain (spasi biasa) rapat. (597× U+2002, 24× U+2003 di seluruh Qur'an.)
- **Perbaikan:** `foldSpaces()` di [build-xteink-pdf.js](build-xteink-pdf.js) ubah
  U+2002/U+2003 → spasi biasa (lalu HTML collapse). Juga ditambah ke sumber
  `normalizeArabic()` (builder.js) & `normalizeForLpmq()` (build-juzamma.js).
- **Verifikasi:** render Al-Kahf 1 — nomor ① kini sejarak satu spasi, seragam dgn ayat lain.

### Fixed — ruang kosong besar setelah nomor halaman (ayat berikut loncat)
- **Masalah:** di sebagian halaman, setelah nomor halaman mushaf ada ~40pt kosong lalu
  ayat berikutnya loncat ke halaman baru, padahal masih muat.
- **Sebab:** `orphans`/`widows` default Chrome = 2 → menolak menaruh 1 baris awal blok
  ayat berikutnya di dasar halaman, memaksa seluruh blok pindah → sisa kosong.
- **Perbaikan:** `html,body{orphans:1;widows:1}` di [build-xteink-pdf.js](build-xteink-pdf.js)
  → konten mengalir mengisi halaman (sesuai niat continuous-flow).
- **Verifikasi:** render Al-Kahf — ayat 5-7 kini langsung menyusul nomor ٢٩٣; total
  halaman turun 1944→1926 (X4).

### File yang di-rebuild & terverifikasi
- `dist/Al-Quran/epub/Universal/Al-Quran (IndoPak Format).epub` → disalin ke `Al-Quran.epub`
- `dist/Al-Quran/pdf/Xteink-X4/Al-Quran Xteink X4.pdf` (1926 hlm, 114 bookmark)
- `dist/Al-Quran/pdf/Xteink-X3/Al-Quran Xteink X3.pdf` (2039 hlm, 114 bookmark)

> **Langkah device:** `.xtcz` lama sudah kedaluwarsa — konversi ulang PDF X4 baru lewat
> aplikasi Xteink resmi agar perbaikan keheh + cover ikut terbawa.
