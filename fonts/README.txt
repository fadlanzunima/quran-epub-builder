FONTS
=====

Both editions are Arabic-only; they differ only in script (Uthmani vs IndoPak).

The builder auto-downloads OFL (freely redistributable) fallbacks so the build
works immediately:
  • Edition 1 (Uthmani): Amiri Quran        (AmiriQuran-Regular.ttf)
  • Edition 2 (IndoPak): Scheherazade New   (ScheherazadeNew-Regular.ttf)

TO USE YOUR OWN FONTS, drop the file here (or in assets/fonts/) and the builder
will prefer it automatically (checked BEFORE the fallback download):

  Edition 1 — "KFGQPC Uthmanic Script HAFS"
     Save as:  UthmanicHafs.ttf  /  UthmanicHafs.otf
     Source:   King Fahd Glorious Quran Printing Complex — fonts.qurancomplex.gov.sa

  Edition 2 — an IndoPak-style Quran font (for text_indopak). Supported names:
     me_quran.ttf, AlQalam.ttf, AlQalamQuran.ttf, PDMS_Saleem_QuranFont.ttf,
     NotoNastaliqUrdu-Regular.ttf, IndoPak.ttf
     Sources:  me_quran / PakType / QuranWBW font packs; Noto Nastaliq Urdu
               (Google Fonts, OFL) is a safe freely-redistributable option.

Accepted extensions: .ttf, .otf (both get a valid @font-face + OPF MIME type).
Licensing note: confirm redistribution rights for KFGQPC / LPMQ before
publishing or uploading the resulting EPUB publicly.
