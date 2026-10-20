# assets/ — drop your binary assets here before building

The builder copies whatever it finds here into the EPUB. Nothing here is
fetched automatically (fonts and images are not on the quran.com API).

```
assets/
├── cover.jpg                 ← main EPUB cover (your "Cover Image")
├── divider.png               ← surah ornament (your "Divider/Ornament", transparent PNG)
└── fonts/
    ├── LPMQ-IsepMisbah.ttf           (Indonesian edition – primary)
    ├── ScheherazadeNew-Regular.ttf   (Indonesian edition – fallback)
    ├── UthmanicHafs.ttf              (English edition – primary, KFGQPC Uthmanic Script HAFS)
    └── AmiriQuran-Regular.ttf        (English edition – fallback)
```

## Preparing the images

1. **cover.jpg** — export your cover art as JPEG, ~1600×2560 px, sRGB.
   (Save your `Gemini_Generated_Image_we9litwe9litwe9l.jpg` here, renamed.)
2. **divider.png** — the ornament/band from
   `Gemini_Generated_Image_b5b14rb5b14rb5b1.jpg`. Export as a **transparent PNG**,
   trimmed tight, ~1000 px wide. (If you leave it as a white-background JPG it
   still works but won't blend in dark mode — PNG with transparency is better.)

If a file is missing the build still succeeds: the cover falls back to a text
title, ornaments are skipped, and the Arabic font stack falls back to any
system Arabic font. Fonts are what matter most — add at least the two primaries.

## File names are exact

The `EDITIONS` config in `builder.js` references these exact file names. If your
downloaded font has a different name, either rename the file or edit the `file:`
value in `builder.js`.
