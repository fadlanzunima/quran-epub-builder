# Catatan Penyesuaian Kobo (KEPUB) — Al-Qur'an & Dzikir

Catatan praktis supaya membuat/ekspor edisi **KEPUB untuk Kobo** ke depannya gampang dan
langsung bisa sync. Semua poin di bawah hasil temuan nyata saat menyiapkan edisi
Indonesia, Inggris, Juz 'Amma, Dzikir, dan Arab-only.

---

## 1. Checklist file KEPUB yang PASTI muncul & sync di Kobo

Sebuah `.kepub.epub` baru akan muncul di library Kobo (side-load USB) **hanya jika**
semua ini terpenuhi. Pakai edisi **`Al-Quran.kepub.epub`** / **`Juz 'Amma`** sebagai acuan —
keduanya sudah terbukti sync.

| # | Syarat | Kenapa |
|---|--------|--------|
| 1 | **`<guide>` EPUB2 ADA di opf** dengan `type="cover"`, `type="toc"`, `type="text"` | **PALING KRITIS.** Importer side-load Kobo memakai `<guide>` untuk mengenali buku. Tanpa ini buku **diam-diam tidak muncul** walau file 100% valid. |
| 2 | `<meta name="cover" content="cover-image"/>` (gaya EPUB2) di `<metadata>` | Supaya cover tampil di library. |
| 3 | `mimetype` = entry **pertama** di ZIP dan **`Stored`** (tanpa kompresi, tanpa extra-field) | Syarat OCF. Kalau tidak, importer bisa menolak. |
| 4 | Ekstensi file **`.kepub.epub`** | Menandakan format Kobo (dapat paginasi/"x mins to go"). |
| 5 | opf valid: `<package unique-identifier="X">` cocok dengan `<dc:identifier id="X">`, ada `dcterms:modified`, spine tidak kosong | Validitas EPUB3 dasar. |

Template `<guide>` (href relatif ke folder opf, mis. `OEBPS/`), taruh **sebelum `</package>`**:

```xml
<guide>
  <reference type="cover" title="Cover" href="cover.xhtml"/>
  <reference type="toc"   title="Daftar Isi" href="toc.xhtml"/>   <!-- atau nav.xhtml -->
  <reference type="text"  title="Begin" href="text/surah-001.xhtml"/> <!-- halaman baca pertama -->
</guide>
```

> Gejala khas kalau `<guide>` hilang: **"sudah dicopy tapi tidak muncul di library"**.
> Edisi Al-Quran & Juz 'Amma muncul; Indonesia/Inggris/Dzikir dulu tidak — persis karena ini.

---

## 2. Resep konversi: EPUB biasa → KEPUB Kobo

Langkah yang diterapkan ke tiap edisi (lihat script di `scripts/` bila sudah di-commit,
atau rekonstruksi dari catatan ini):

1. **Inject `koboSpan`** ke `title.xhtml` + semua file surah/isi (JANGAN cover & nav).
   - Skema id: `kobo.{paragraf}.{segmen}`.
   - `paragraf` **naik tiap elemen blok** (section, header, div, p, h1–h6, img, hr, aside…).
   - `paragraf` **tidak naik** untuk elemen inline (span, a, sup, sub, b, i, em, br…).
   - `segmen` reset tiap blok baru, **naik per text-node** di dalam subtree blok itu.
   - **Tanpa sentence-splitting** — satu text-node = satu `koboSpan` (segmen maks = 2).
   - Mulai hitung dari elemen pertama di dalam `<body>` (body sendiri tidak dihitung).
2. **Pin font Arab `!important`** di akhir CSS (Kobo menimpa font publisher dengan font UI-nya
   yang tak punya glyph Arab → tofu). Selektor memakai kelas Arab edisi itu, mis.:
   ```css
   .arabic, .arabic *, .surah-title, .bismillah, .title-arabic, .ayah-num {
     font-family: '<font Arab embed>', 'Amiri', 'Noto Naskh Arabic', serif !important;
   }
   ```
   (Juz 'Amma pakai kelas `.teks-arab`, `.judul-surah`, `.basmalah`, `.nomor-ayat`, dst.)
3. **Strip nama Arab di ToC/nav** (`"78. An-Naba — النبإ"` → `"78. An-Naba"`) supaya tak tofu
   di menu native Kobo. Regex: buang ` — ` + rangkaian huruf Arab sampai `<`.
4. **opf**: suffix `-kobo` pada `dc:identifier`, tambah ` (Kobo)` pada `dc:title` utama,
   **tambahkan `<guide>`** (poin 1), tambah `ibooks:specified-fonts=true` (parity).
5. **Repackage**: `mimetype` pertama + `Stored`, sisanya `Deflate`.
6. **(khusus Al-Qur'an)** perbaiki nomor Juz di header surah bila salah
   (bug lama: nomor Juz = nomor surah; At-Tin tampil "Juz 95" seharusnya "Juz 30").
   Mapping surah→juz-awal diambil dari `toc.ncx` (tiap surah ter-nest di bawah juz awalnya).

---

## 3. Setelan di perangkat Kobo (sisi pembaca)

- **Huruf Arab putus-putus (tidak menyambung)?** Di buku → menu **Aa** → pilih
  **"Publisher default font" / aktifkan "Use publisher styles"**. Jangan pilih font bawaan
  Kobo — font Kobo tidak melakukan *shaping* Arab dan menimpa CSS `!important`.
- **Side-load**: copy `.kepub.epub` ke root drive Kobo (jangan di folder `.kobo`),
  lalu **eject/cabut dengan aman** — impor baru jalan saat eject.
- Alternatif "proper" (pertahankan fitur kepub penuh): **Calibre + plugin KoboTouchExtended**
  → *Send to device*; mendaftarkan kepub ke database Kobo.

---

## 4. Validasi cepat sebelum kirim ke Kobo

Cek minimal ini untuk tiap `.kepub.epub`:

- [ ] `<guide>` ada: `cover`, `toc`, `text` (dan href-nya benar-benar ada di dalam epub)
- [ ] `mimetype` = entry pertama, method `Stored`
- [ ] Semua file XHTML/opf/ncx **well-formed** (parse XML tanpa error)
- [ ] `koboSpan` id **unik** per dokumen, tidak ada duplikat
- [ ] Semua `href` manifest **resolve** (tidak ada file hilang)
- [ ] Font Arab embed + di-pin `!important`

Bandingkan selalu dengan acuan `Al-Quran.kepub.epub` / `Juz 'Amma & Terjemahan.kepub.epub`.
