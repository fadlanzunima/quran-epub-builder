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
npm run build:x4-epub    # -> dist/Al-Quran Xteink X4.epub
npm run build:x4-pdf     # -> dist/Al-Quran Xteink X4.pdf   (butuh Chrome/Edge)
```

| File | Kapan dipakai | Catatan |
|---|---|---|
| **Al-Quran Xteink X4.epub** | Baca native di X4; teks **reflow mengikuti layar** & setting ukuran font device | Dekorasi diringankan untuk ESP32 (bingkai & divider dibuang). **Perlu font `.bin`** agar Arab muncul. |
| **Al-Quran Xteink X4.pdf** | Jalur paling pasti — Arab sudah "dibakar", tiap halaman = 1 layar X4 (480×800) | Tidak perlu font device. Jika X4 menolak PDF mentah, konversi dulu via app resmi Xteink. |

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

## Cara 2 — PDF ukuran X4 (paling pasti, tanpa font device)

1. `npm run build:x4-pdf` → `dist/Al-Quran Xteink X4.pdf`.
   Tiap halaman tepat **55.43 × 92.36 mm = 480×800 px @ 220 PPI**, teks mengalir
   kontinu (tidak ada halaman kosong / terpotong).
2. Salin PDF ke microSD dan buka. Karena halaman = ukuran layar, tampil 1:1.
3. Kalau firmware menolak PDF mentah, jalankan dulu lewat **app resmi Xteink**
   untuk konversi, baru transfer.

Mau Arab lebih besar/kecil di PDF? Edit konstanta `X4` di
[build-x4-pdf.js](build-x4-pdf.js) (`arabicPx`, `arabicLineHeight`, dst) lalu
build ulang.

---

## Kenapa tidak cukup "embed font di EPUB" saja?

Pembaca EPUB biasa (Boox, Kobo, Apple Books, Calibre) menghormati `@font-face`,
jadi font embed cukup. **X4 tidak** — firmware ESP32-nya hanya punya satu mesin
font device berbasis `.bin`. Jadi untuk X4, "embed" yang relevan adalah memuat
font `.bin` ke device (Cara 1) **atau** membakar shaping ke PDF (Cara 2).
