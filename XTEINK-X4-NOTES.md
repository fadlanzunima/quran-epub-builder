# Xteink X4 — Al-Qur'an (EPUB + PDF)

Catatan cara menampilkan Al-Qur'an dengan benar di **Xteink X4** (dan tipe
sekelas: X4 Pro / X4 Classic). Edisi yang dipakai: **Uthmani Arab-only**
(`dist/Al-Quran.epub`, font KFGQPC Uthmanic Hafs).

## Fakta penting tentang X4

| Hal | Nilai |
|---|---|
| Layar | 4.3" · **800×480 px** · **220 PPI** |
| Ukuran layar fisik | **55.43 × 92.36 mm** (480/220″ × 800/220″) |
| CPU | ESP32 (mikrokontroler, bukan Android/Linux) |
| Format buku | TXT (UTF-8), EPUB |
| Format gambar | BMP, JPG |
| Format font | **`.bin` proprietary Xteink saja** |
| PDF/MOBI | didukung sebagian — disarankan konversi via app resmi Xteink |

> **Konsekuensi #1:** X4 **tidak memakai font `@font-face` yang di-embed di
> EPUB**. Walau EPUB ini meng-embed font Uthmani (berguna untuk Boox/Kobo/
> Calibre), X4 merendernya dengan **font device**. Supaya Arab tampil benar di
> X4, Anda harus memuat font Arab sebagai **font device `.bin`** (lihat bawah).
>
> **Konsekuensi #2:** PDF membakar *shaping* Arab saat render (joining + harakat
> sudah jadi gambar vektor), jadi **tidak bergantung** pada font device. Itu
> sebabnya kita juga menyediakan PDF ukuran-layar-X4 sebagai jalur paling pasti.

---

## Dua file untuk X4

Jalankan:

```bash
npm run build:x4-epub    # -> dist/Al-Quran Xteink X4.epub  (reflow: cocok X3, X4, X4 Pro)
npm run build:xteink-pdf # -> PDF X4 + X3 sekaligus         (butuh Chrome/Edge)
npm run build:x4-pdf     # -> dist/Al-Quran Xteink X4.pdf   (X4 / X4 V2 / X4 Pro)
npm run build:x3-pdf     # -> dist/Al-Quran Xteink X3.pdf   (X3)
```

| File | Kapan dipakai | Catatan |
|---|---|---|
| **Al-Quran Xteink X4.epub** | Baca native (reflow); cocok **semua** model (X3/X4/X4 Pro) karena ikut layar | Dekorasi diringankan untuk ESP32 (bingkai & divider dibuang). **Perlu font `.bin`** agar Arab muncul. |
| **Al-Quran Xteink X4.pdf** | Jalur paling pasti untuk **X4 / X4 V2 / X4 Pro** — tiap halaman = 1 layar (480×800) | Arab sudah "dibakar", tidak perlu font device. |
| **Al-Quran Xteink X3.pdf** | Jalur paling pasti untuk **X3** — tiap halaman = 1 layar (~528×792 @ 259 PPI) | Resolusi X3 belum resmi; cek Settings → About, lalu sesuaikan `DEVICES.x3.resPx` bila beda. |

> PDF itu **fixed-size per device**: PDF X4 bila dibuka di X3 akan *letterbox* (beda
> rasio), jadi pakai PDF sesuai modelnya. EPUB reflow cocok untuk semua model.

---

## Cara 1 — EPUB + font device `.bin` (reflow, ikut ukuran layar)

Ini jalur native X4 dan paling nyaman dibaca (bisa ubah ukuran font di device).

1. **Pilih font Arab TTF** yang lengkap glyph + harakat. Rekomendasi (OFL, bebas
   redistribusi): `assets/fonts/AmiriQuran-Regular.ttf`.
   (KFGQPC `UthmanicHafs.otf` juga bagus tapi berlisensi terbatas, dan `.otf`
   CFF kadang kurang mulus dikonversi ke bitmap `.bin` — TTF lebih aman.)
2. **Konversi TTF → `.bin`** memakai **tool/app font resmi Xteink**
   (Xteink Font Converter / aplikasi pendamping X4). Ikuti panduan resmi:
   pilih TTF, set rentang Unicode mencakup **Arabic (U+0600–06FF)** dan
   **Arabic Presentation Forms** jika tersedia, lalu ekspor `.bin`.
3. **Salin `.bin`** ke folder font di microSD X4 (mis. `/fonts`), lalu di
   **Settings → Font** pilih font tersebut sebagai font baca.
4. Salin **`Al-Quran Xteink X4.epub`** ke microSD, buka, set ukuran font sesuai
   selera. Teks akan reflow mengikuti layar 480×800.

> Jika Arab muncul sebagai kotak/terputus: font `.bin` belum memuat glyph Arab,
> atau belum dipilih sebagai font aktif. Ulangi langkah 2–3 dengan rentang
> Unicode Arab disertakan.

## Cara 2 — PDF ukuran device (paling pasti, tanpa font device)

1. `npm run build:x4-pdf` (X4) atau `npm run build:x3-pdf` (X3).
   - X4: tiap halaman **55.43 × 92.36 mm = 480×800 px @ 220 PPI**.
   - X3: tiap halaman **~51.78 × 77.67 mm = 528×792 px @ 259 PPI**.
   Teks mengalir kontinu (tidak ada halaman kosong / terpotong).
2. Salin PDF (sesuai modelnya) ke microSD dan buka. Karena halaman = ukuran
   layar, tampil 1:1 tanpa letterbox.
3. Kalau firmware menolak PDF mentah, jalankan dulu lewat **app resmi Xteink**
   untuk konversi, baru transfer.

**Font PDF:** di-"bakar" dengan **LPMQ Isep Misbah** (Mushaf Standar Indonesia,
Kemenag) — merender tanda tajwid *iqlab* (meem kecil) dengan bersih; KFGQPC
menampilkannya seperti bercak hitam di e-ink. Ganti lewat konstanta `QURAN_FONT`
di [build-xteink-pdf.js](build-xteink-pdf.js) (mis. ke `AmiriQuran-Regular.ttf`,
OFL — tanda iqlab paling tegas & bebas lisensi untuk publik). Lisensi LPMQ: aman
untuk pribadi/dakwah; untuk publikasi publik/komersial, konfirmasi izin Kemenag.

Mau Arab lebih besar/kecil, atau tambah profil device baru? Edit `DEVICES` di
[build-xteink-pdf.js](build-xteink-pdf.js) (`resPx`, `ppi`, `arabicPx`,
`arabicLineHeight`, dst). Cek hasilnya tanpa build penuh: `npm run preview:x4`
atau `npm run preview:x3` (bisa `node preview-xteink.js x3 36 55 78` untuk surah
pilihan) lalu build ulang.

---

## Kenapa tidak cukup "embed font di EPUB" saja?

Pembaca EPUB biasa (Boox, Kobo, Apple Books, Calibre) menghormati `@font-face`,
jadi font embed cukup. **X4 tidak** — firmware ESP32-nya hanya punya satu mesin
font device berbasis `.bin`. Jadi untuk X4, "embed" yang relevan adalah memuat
font `.bin` ke device (Cara 1) **atau** membakar shaping ke PDF (Cara 2).
