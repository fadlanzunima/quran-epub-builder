# File siap dikonversi ke `.xtc` / `.xtcz` (Xteink)

> Catatan cepat: **file mana yang cocok dirender ke `.xtc`** dan mana yang belum.
> Aturan lengkap: [XTEINK-X4-NOTES.md](XTEINK-X4-NOTES.md).

## 📐 Patokan (reference) — `dist/Al-Quran/pdf/Universal/Al-Quran.pdf`

File yang sudah terbukti menghasilkan `.xtcz` berfungsi di Xteink. Spesifikasinya menjadi acuan:

| Properti | Nilai |
|---|---|
| Ukuran halaman | **91 × 123 mm** (257.95 × 348.66 pt) — *bukan* 480×800 |
| Bookmark / outline | **bertingkat**: "Juz N" (level 1) → surah (level 2) |
| Font Arab | **LPMQ Isep Misbah (Kemenag)**, di-bake |
| Halaman | 1373 |

> ✅ File X4 dzikir & juz amma kini **sudah disamakan** ke patokan ini (91×123mm + bookmark bertingkat + Kemenag).

## Aturan baku (ringkas)

Ke perangkat Xteink **selalu PDF dulu**, lalu konversi ke `.xtcz` **pakai app resmi Xteink**.
PDF-nya WAJIB memenuhi 3 hal (kalau tidak, konten tidak tampil / daftar bab kosong):

1. **Ukuran halaman = layar device** — X4 = 480×800 @220ppi (156.96×262.08 pt).
2. **Font Arab di-bake** (Kemenag / LPMQ Isep Misbah) — bukan font device.
3. **Ada outline/bookmark PDF** per bab — sumber daftar bab di `.xtcz`.

`build-epub-pdf.js` (profil `x4`) otomatis memenuhi ketiganya dan **menolak build** bila ada yang kurang.

## ✅ Siap konversi (lolos semua aturan)

| File | Device | Hal | Build |
|---|---|---|---|
| `dist/Dzikir Pagi Petang/pdf/Xteink-X4/Dzikir Pagi dan Petang Xteink X4.pdf` | X4 | 57 hlm · 91×123mm · bookmark bertingkat (Pagi/Petang→item) ✓ · Kemenag ✓ | `npm run build:x4-dzikir-pdf` |
| `dist/Juz Amma/pdf/Xteink-X4/Juz 'Amma & Terjemahan Xteink X4.pdf` | X4 | 255 hlm · 91×123mm · bookmark bertingkat (Juz 30→surah) ✓ · Kemenag ✓ | `npm run build:x4-juzamma-pdf` |

Build keduanya sekaligus: `npm run build:x4-pdf`

## ⚠️ Device-size tapi BELUM siap (jangan dipakai dulu untuk .xtcz)

| File | Kekurangan |
|---|---|
| `dist/Al-Quran/pdf/Xteink-X3/Al-Quran Xteink X3.pdf` | **Tanpa bookmark** (dibuat `build-xteink-pdf.js`, belum menambah outline) → daftar bab `.xtcz` akan kosong. Juga ukuran **X3** (bukan X4). |
| Al-Quran PDF X4 | Saat ini **belum ada** (file lama terhapus). `build-xteink-pdf.js` juga belum menambah bookmark. |

> Catatan: Al-Quran dibangun lewat `build-xteink-pdf.js`, yang **belum** punya langkah bookmark/outline seperti `build-epub-pdf.js`. Kalau Al-Quran mau dikirim ke X4 via `.xtcz`, langkah bookmark perlu ditambahkan dulu ke pipeline itu — minta saja.

## Alur konversi

```
npm run build:x4-pdf            # hasilkan/refresh PDF X4 (dengan bookmark)
→ salin PDF X4 ke komputer
→ buka di APP RESMI Xteink, konversi ke .xtcz
→ salin .xtcz ke microSD X4
```
