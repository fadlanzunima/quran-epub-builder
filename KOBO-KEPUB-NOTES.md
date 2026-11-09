# Catatan Penyesuaian Kobo — Al-Qur'an & Dzikir

Catatan praktis supaya membuat/ekspor edisi untuk Kobo ke depannya gampang. Perangkat uji:
**Kobo Clara Colour**. Status tiap poin ditandai: ✅ TERVERIFIKASI di device · ⚠️ HIPOTESIS/
belum pasti · ❌ TERBUKTI SALAH (jangan diandalkan).

> Edisi yang **terbukti muncul & bisa dibuka** di Clara Colour: **Dzikir, Indonesia, Inggris**
> (impor normal oleh nickel sebagai kepub). Edisi **Al-Quran (Arab-only) & Juz 'Amma**
> awalnya TIDAK bisa diimpor scanner — lihat Bagian 5.

---

## 1. Agar kepub side-load MUNCUL di library

| # | Syarat | Status |
|---|--------|--------|
| 1 | **`<guide>` EPUB2 di opf** (`type="cover"`, `type="toc"`, `type="text"`) | ✅ **Paling kritis.** Indonesia/Inggris/Dzikir baru muncul setelah `<guide>` ditambahkan. Tanpa `<guide>` buku diam-diam tak muncul walau file 100% valid. |
| 2 | `<meta name="cover" content="cover-image"/>` (EPUB2) | ✅ untuk cover di library |
| 3 | `mimetype` = entry **pertama** + **`Stored`** (tanpa kompresi/extra-field) | ✅ syarat OCF |
| 4 | opf valid: `unique-identifier` cocok `dc:identifier`, ada `dcterms:modified`, spine terisi | ✅ |
| 5 | Idealnya **satu `<dc:title>`** (hindari `<dc:title id="subtitle">` tanpa `refines`) | ⚠️ praktik baik, TAPI **bukan** penyebab AQ/Juz gagal impor (sudah dicoba, tetap gagal). Jangan andalkan sebagai "obat" impor. |

Template `<guide>` (href relatif ke folder opf), taruh **sebelum `</package>`**:

```xml
<guide>
  <reference type="cover" title="Cover" href="cover.xhtml"/>
  <reference type="toc"   title="Daftar Isi" href="toc.xhtml"/>   <!-- atau nav.xhtml -->
  <reference type="text"  title="Begin" href="text/surah-001.xhtml"/>
</guide>
```

---

## 2. Resep konversi EPUB → KEPUB (koboSpan)

1. **Inject `koboSpan`** ke `title.xhtml` + semua file isi (JANGAN cover & nav). Skema
   `kobo.{paragraf}.{segmen}`: `paragraf` naik tiap elemen **blok** (section/header/div/p/
   h1–h6/img/hr/aside), **tidak** untuk inline (span/a/sup/sub/b/i/br). `segmen` reset tiap
   blok, +1 per text-node. **Tanpa** sentence-split (segmen maks 2). Mulai dari elemen
   pertama di dalam `<body>`.
2. **Pin font Arab `!important`** di akhir CSS (Kobo menimpa font publisher). Selektor sesuai
   kelas Arab tiap edisi (`.arabic`, atau `.teks-arab/.judul-surah/.basmalah/.nomor-ayat`).
3. **Strip nama Arab di ToC/nav** (`"78. An-Naba — النبإ"` → `"78. An-Naba"`).
4. **opf**: suffix `-kobo` di `dc:identifier`, ` (Kobo)` di `dc:title` utama, tambah
   `<guide>` (Bagian 1), `ibooks:specified-fonts=true`.
5. **Repackage**: `mimetype` pertama + `Stored`, sisanya `Deflate`.
6. **(Al-Qur'an)** perbaiki nomor Juz header bila salah (bug lama: Juz = nomor surah; At-Tin
   "Juz 95" → "Juz 30"). Mapping surah→juz-awal dari `toc.ncx`.

---

## 5. Temuan TERVERIFIKASI di Kobo Clara Colour (debugging Nov 2026)

### 5a. Impor & buka
- ✅ **Menyuntik baris ke `KoboReader.sqlite` membuat buku MUNCUL, tapi nickel MENOLAK
  MEMBUKANYA** — error *"couldn't be opened"* atau *"not authorized / Adobe DRM"*. nickel
  hanya mau membuka buku yang **ia impor sendiri**. Jadi injeksi DB **bukan** solusi lengkap.
- ✅ **DRM palsu dari injeksi**: kloning baris kepub membawa `IsEncrypted='true'` → untuk
  `application/epub+zip` memicu error DRM Adobe. Tetap tak cukup walau di-`false`-kan, karena
  akar masalahnya buku tak diimpor nickel.
- ⚠️ **Scanner nickel melewatkan AQ/Juz sebagai `.kepub.epub`** (alasan pasti belum ketahuan;
  file 100% valid — mimetype/zip/opf/guide semua benar). Dugaan: jalur impor KEPUB lebih ketat.
- ⚠️ **Rencana perbaikan**: rename ke **`.epub` biasa** + **hapus baris injeksi** → biarkan
  nickel memindai & mengimpor via jalur EPUB sederhana (belum dikonfirmasi berhasil).
- ✅ **Reboot penuh** memicu scan ulang `/mnt/onboard` + membuang cache nickel (DRM/err lama).
  Eject saja sering tak memicu "Importing content".
- ℹ️ ContentID side-load = `file:///mnt/onboard/<namafile>` (berbasis **path**, bukan metadata).
  Backup `KoboReader.sqlite` sebelum menyentuhnya.

### 5b. Render Arab (KRUSIAL)
- ✅ **Clara Colour render Arab SEDERHANA dengan benar** (Dzikir: harakat basic) ...
- ❌ ...tapi **GAGAL pada teks Qurani Uthmani penuh** (banyak harakat + tanda waqf):
  - Font **LPMQ** / **Scheherazade** → huruf **putus-putus** (shaping gagal).
  - Font **KFGQPC Uthmanic Script HAFS** → harakat/waqf jadi **titik hitam** (glyph hilang).
- ❌ **Setelan pembaca TIDAK menyelesaikan** (Justification Off / Publisher font sudah dicoba,
  tetap putus). Jadi ini **keterbatasan font+engine**, harus diperbaiki di level file.
- ⚠️ **Perbaikan sedang diuji: ganti font Arab ke `Amiri Quran`** (cakupan Qurani lengkap).
  Diterapkan ke edisi Inggris dulu — **tunggu konfirmasi** sebelum dijadikan standar.
- 📌 Koreksi untuk Bagian 3: saran lama "pakai Publisher font untuk menyembuhkan Arab putus"
  **TIDAK terbukti** di Clara Colour. Yang menentukan adalah **pilihan font di file**.

---

## 3. Setelan perangkat & side-load

- **Side-load**: copy file ke root drive (bukan folder `.kobo`) → **eject** → kalau tak ada
  "Importing content", **reboot** untuk memaksa scan.
- Alternatif "proper": **Calibre + plugin KoboTouchExtended** (mendaftarkan kepub ke DB dgn
  benar — termasuk membuatnya bisa dibuka, beda dari injeksi manual mentah).

## 4. Validasi file sebelum kirim
- [ ] `<guide>` (cover/toc/text) ada & href-nya resolve
- [ ] `mimetype` pertama + `Stored`
- [ ] Semua XHTML/opf/ncx well-formed; `koboSpan` id unik; href manifest resolve
- [ ] Font Arab embed + di-pin; untuk teks Qurani penuh pakai font bercakupan lengkap (uji dulu)
