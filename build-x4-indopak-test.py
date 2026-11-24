# -*- coding: utf-8 -*-
"""
build-x4-indopak-test.py  —  DIAGNOSTIC / EXPERIMENTAL (does not touch any
existing build output). Produces a SEPARATE file:

    dist/Al-Quran Xteink X4 (IndoPak Uji).epub

Goal: test whether a small, reflowable TEXT epub can render joined Arabic +
harakat on the shaper-less Licorice firmware by PRE-SHAPING the text ourselves
(Unicode base letters -> Arabic Presentation Forms) using the IndoPak
(QuranWBW) font, whose cmap uniquely contains the full presentation forms.

Because we don't yet know if Licorice does bidi reordering, the epub contains
three clearly-labelled variants of the SAME short surahs so one on-device read
tells us which build strategy is correct:

  A. pre-shaped + visually REVERSED + manually line-wrapped   (correct if NO bidi)
  B. pre-shaped + logical order (not reversed), device wraps  (correct if bidi)
  C. raw Unicode (no pre-shape)  = current approach, baseline (expected broken)

Requires: fonttools, arabic-reshaper  (Python 3). No node needed.
Run:  python build-x4-indopak-test.py
"""
import os, io, json, zipfile, html
import arabic_reshaper
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.abspath(__file__))
FONT_PATH = os.path.join(ROOT, "assets", "fonts",
                         "AlQuran IndoPak by QuranWBW",
                         "AlQuran IndoPak by QuranWBW.ttf")
QDATA = "/tmp/qdata"     # produced by the fetch step (ch1/112/114/2.json)
OUT = os.path.join(ROOT, "dist", "Al-Quran Xteink X4 (IndoPak Uji).epub")

# ---- font metrics for manual wrapping ---------------------------------------
_f = TTFont(FONT_PATH)
_cmap = _f.getBestCmap()
_hmtx = _f["hmtx"]
_upm = _f["head"].unitsPerEm
_gname = {cp: _cmap[cp] for cp in _cmap}

def adv_units(ch):
    g = _gname.get(ord(ch))
    if not g:
        return 0
    return _hmtx[g][0]

ARABIC_PX = 32          # fixed font-size used for manual wrapping (section A)
USABLE_PX = 440         # X4 is 480px wide; leave a little margin

def line_width_px(s):
    u = sum(adv_units(c) for c in s)
    return u * ARABIC_PX / _upm

_reshaper = arabic_reshaper.ArabicReshaper({'delete_harakat': False,
                                            'support_ligatures': True})

def preshape(s):
    return _reshaper.reshape(s)

def visual_reverse(s):
    return s[::-1]

AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
def ar_num(n):
    return "".join(AR_DIGITS[int(d)] for d in str(n))

# ---- load verses ------------------------------------------------------------
def load(ch):
    return json.load(open(os.path.join(QDATA, f"ch{ch}.json"), encoding="utf-8"))

SURAHS = [
    ("Al-Faatihah (1)", load(1)),
    ("Al-Ikhlaas (112)", load(112)),
    ("An-Naas (114)", load(114)),
    # a couple of longer Al-Baqarah ayat to stress line-wrapping:
    ("Al-Baqarah 2:19-20 (uji wrap)", [v for v in load(2) if v[0] in ("2:19", "2:20")]),
]

# ---- section builders -------------------------------------------------------
def esc(s):
    return html.escape(s)

def section_A(surahs):
    """pre-shaped + reversed + manual wrap. Each visual line is its own block."""
    out = []
    for title, verses in surahs:
        out.append(f'<h2>{esc(title)}</h2>')
        for key, text in verses:
            words = text.split(" ")
            lines, cur = [], ""
            for w in words:
                trial = (cur + " " + w).strip()
                if cur and line_width_px(preshape(trial)) > USABLE_PX:
                    lines.append(cur)
                    cur = w
                else:
                    cur = trial
            if cur:
                lines.append(cur)
            n = key.split(":")[1]
            # append ayah number marker to the LAST logical line
            lines[-1] = lines[-1] + " ۝" + ar_num(n)
            for i, ln in enumerate(lines):
                vis = visual_reverse(preshape(ln))
                out.append(f'<div class="ar">{esc(vis)}</div>')
    return "\n".join(out)

def section_B(surahs):
    """pre-shaped, logical order (not reversed); device does wrapping + bidi."""
    out = []
    for title, verses in surahs:
        out.append(f'<h2>{esc(title)}</h2>')
        buf = []
        for key, text in verses:
            n = key.split(":")[1]
            buf.append(preshape(text) + " ۝" + ar_num(n))
        out.append('<p class="ar rtl">' + esc(" ".join(buf)) + '</p>')
    return "\n".join(out)

def section_C(surahs):
    """raw Unicode, logical order — baseline (what the current epub stores)."""
    out = []
    for title, verses in surahs:
        out.append(f'<h2>{esc(title)}</h2>')
        buf = []
        for key, text in verses:
            n = key.split(":")[1]
            buf.append(text + " ۝" + ar_num(n))
        out.append('<p class="ar rtl">' + esc(" ".join(buf)) + '</p>')
    return "\n".join(out)

# ---- xhtml/epub plumbing ----------------------------------------------------
def page(title, body):
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!DOCTYPE html>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="id" lang="id">\n'
        f'<head><meta charset="utf-8"/><title>{esc(title)}</title>'
        '<link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        f'<body>{body}</body></html>\n'
    )

CSS = f"""
@font-face {{
  font-family: 'IndoPakTest';
  src: url('fonts/IndoPak.ttf');
  font-weight: normal; font-style: normal;
}}
html,body {{ margin:0; padding:0 2%; background:#fff; color:#000; }}
h1 {{ font-size:1.1em; text-align:center; }}
h2 {{ font-size:.95em; text-align:center; color:#333; margin:.9em 0 .3em;
      border-bottom:1px solid #999; padding-bottom:.2em; }}
.note {{ font-size:.85em; color:#333; line-height:1.5; }}
.ar {{ font-family:'IndoPakTest', serif; }}
/* Section A lines: fixed size, no wrapping, LTR draw of pre-reversed text */
div.ar {{ font-size:{ARABIC_PX}px; line-height:1.9; white-space:pre;
          direction:ltr; unicode-bidi:bidi-override; text-align:right; }}
/* Sections B/C: let the reader wrap, RTL paragraph */
p.ar.rtl {{ font-size:{ARABIC_PX}px; line-height:2.0; direction:rtl;
            text-align:justify; }}
"""

INTRO = """
<h1>EPUB UJI — IndoPak pre-shaped (Xteink X4)</h1>
<p class="note">
File ini <b>percobaan</b>, bukan mushaf final. Tujuannya menguji apakah teks
(kecil, reflow) bisa tampil tersambung + harakat benar di Licorice tanpa ganti
firmware.<br/><br/>
<b>Langkah:</b> pasang font <i>AlQuran IndoPak by QuranWBW.ttf</i> sebagai font
device di X4, lalu pilih sebagai font baca. Buka tiap bagian di bawah dan
laporkan <b>bagian mana</b> yang hurufnya menyambung dan harakatnya benar:<br/><br/>
&bull; <b>Bagian A</b> — pre-shaped + dibalik + dilipat manual<br/>
&bull; <b>Bagian B</b> — pre-shaped + urutan biasa (device yang melipat)<br/>
&bull; <b>Bagian C</b> — teks mentah (pembanding; kemungkinan terputus)<br/>
</p>
"""

def build():
    assert os.path.isfile(FONT_PATH), f"font missing: {FONT_PATH}"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    pages = {
        "intro.xhtml": page("Intro", INTRO),
        "secA.xhtml": page("Bagian A", "<h1>Bagian A — pre-shaped + dibalik + wrap manual</h1>" + section_A(SURAHS)),
        "secB.xhtml": page("Bagian B", "<h1>Bagian B — pre-shaped + urutan biasa</h1>" + section_B(SURAHS)),
        "secC.xhtml": page("Bagian C", "<h1>Bagian C — teks mentah (pembanding)</h1>" + section_C(SURAHS)),
    }
    spine_ids = ["intro", "secA", "secB", "secC"]

    manifest_items = "\n".join(
        f'    <item id="{sid}" href="{sid}.xhtml" media-type="application/xhtml+xml"/>'
        for sid in spine_ids
    )
    spine_items = "\n".join(f'    <itemref idref="{sid}"/>' for sid in spine_ids)

    opf = f"""<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:x4-indopak-test-0001</dc:identifier>
    <dc:title>Al-Quran Xteink X4 (IndoPak Uji)</dc:title>
    <dc:language>id</dc:language>
    <meta property="dcterms:modified">2026-11-24T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="font" href="fonts/IndoPak.ttf" media-type="font/ttf"/>
{manifest_items}
  </manifest>
  <spine>
{spine_items}
  </spine>
</package>
"""

    nav = page("Daftar Isi",
        '<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc">'
        '<h1>Daftar Isi</h1><ol>'
        '<li><a href="intro.xhtml">Intro</a></li>'
        '<li><a href="secA.xhtml">Bagian A</a></li>'
        '<li><a href="secB.xhtml">Bagian B</a></li>'
        '<li><a href="secC.xhtml">Bagian C</a></li>'
        '</ol></nav>')

    container = ('<?xml version="1.0"?>\n'
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
        '<rootfiles><rootfile full-path="OEBPS/content.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles></container>')

    with open(FONT_PATH, "rb") as fh:
        font_bytes = fh.read()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        # mimetype first + stored
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container)
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/nav.xhtml", nav)
        z.writestr("OEBPS/style.css", CSS)
        z.writestr("OEBPS/fonts/IndoPak.ttf", font_bytes)
        for name, content in pages.items():
            z.writestr("OEBPS/" + name, content)

    with open(OUT, "wb") as fh:
        fh.write(buf.getvalue())
    size_kb = os.path.getsize(OUT) / 1024
    print(f"Created: {OUT}")
    print(f"Size: {size_kb:.0f} KB (font {_upm and len(font_bytes)//1024} KB embedded)")

if __name__ == "__main__":
    build()
