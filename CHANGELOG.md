# Changelog

Catatan perubahan yang **sudah diverifikasi benar** (render dicek, bukan sekadar diedit).
Format tanggal: YYYY-MM-DD.

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

### File yang di-rebuild & terverifikasi
- `dist/Al-Quran/epub/Universal/Al-Quran (IndoPak Format).epub` → disalin ke `Al-Quran.epub`
- `dist/Al-Quran/pdf/Xteink-X4/Al-Quran Xteink X4.pdf` (1944 hlm, 114 bookmark)
- `dist/Al-Quran/pdf/Xteink-X3/Al-Quran Xteink X3.pdf` (2061 hlm, 114 bookmark)

> **Langkah device:** `.xtcz` lama sudah kedaluwarsa — konversi ulang PDF X4 baru lewat
> aplikasi Xteink resmi agar perbaikan keheh + cover ikut terbawa.
