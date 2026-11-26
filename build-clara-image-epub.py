#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build-clara-image-epub.py — wrap a baked (pre-shaped) Quran PDF into a
fixed-layout, page-as-image EPUB for the Kobo Clara.

Why: Kobo Clara reflow-shapes Arabic itself and breaks LPMQ/Scheherazade
(disconnected letters). A PDF already has the glyphs baked by Chrome, so if we
turn every PDF page into an image and show those images in a fixed-layout EPUB,
Clara just displays pixels — no device shaping, the font is "wrapped" exactly
as rendered. Mirrors the Xteink .xtc (pages-as-images) idea, in EPUB form.

Usage:
  python build-clara-image-epub.py <src.pdf> <out.kepub.epub> "<Title>" [limitPages]

The OPF follows the Al-Quran Kobo meta: EPUB2 <guide>, <meta name="cover">,
dcterms:modified, correct container media-type (application/oebps-package+xml).
"""
import sys, io, zipfile, html
import fitz  # PyMuPDF
from PIL import Image

def esc(s): return html.escape(str(s), quote=True)

def build(src_pdf, out_path, title, limit=0, width=1072, colors=16):
    doc = fitz.open(src_pdf)
    n = len(doc)
    if limit and limit < n:
        n = limit
    # Clara Colour panel ~1072 wide. Lower `width`/`colors` to shrink the file
    # (fewer colours collapses the cream/green to high-contrast black on white).
    page0 = doc[0]
    pw, ph = page0.rect.width, page0.rect.height
    zoom = float(width) / pw
    IMG_W, IMG_H = round(pw * zoom), round(ph * zoom)

    # The pages are flat art (cream ground + dark-green text), so a 16-colour
    # paletted PNG is both sharp AND ~3x smaller than JPEG for this content.
    pages = []       # (name, png-bytes)
    for i in range(n):
        pix = doc[i].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        if i == 0:
            IMG_W, IMG_H = pix.width, pix.height   # use the REAL pixel size (not rounded)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        buf = io.BytesIO()
        img.convert("P", palette=Image.ADAPTIVE, colors=colors).save(buf, "PNG", optimize=True)
        pages.append((f"page-{i+1:04d}.png", buf.getvalue()))

    MOD = "2026-11-25T00:00:00Z"
    UID = "urn:uuid:quran-clara-baked-v1"

    # --- per-page XHTML ---
    # The image is wrapped in an SVG with a viewBox + preserveAspectRatio="xMidYMid
    # meet". That makes the page scale to FIT the screen (contain, centred) on EVERY
    # reader — both when the fixed-layout viewport is honoured AND when a reader (or
    # a not-yet-kepubified EPUB) falls back to reflow. Absolute-px <img> sizing
    # instead overflowed on Kobo's reflow fallback — the image rendered at 1072 CSS
    # px on a ~750 px-wide panel, so only the top-left corner showed (zoomed/cropped).
    # SVG "meet" never overflows: it shrinks the page to the smaller of width/height.
    # The COVER (first page) instead uses "slice" so it fills the WHOLE screen edge-
    # to-edge (full-bleed) — "slice" scales up to cover the viewport and crops the
    # overflow. The cover aspect (0.738) ≈ Clara's (0.74), so the crop is ~4 px (the
    # decorative border has margin to spare). Content pages keep "meet" so no ayah is
    # ever clipped.
    def page_xhtml(img_name, fit="meet"):
        return (f'<?xml version="1.0" encoding="utf-8"?>\n'
                f'<!DOCTYPE html>\n'
                f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n'
                f'<head><meta charset="utf-8"/>'
                f'<meta name="viewport" content="width={IMG_W}, height={IMG_H}"/>'
                f'<style>*{{margin:0;padding:0}}html,body{{width:100%;height:100%;background:#fff}}'
                f'svg{{display:block;width:100%;height:100%}}</style></head>\n'
                f'<body><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
                f'width="100%" height="100%" viewBox="0 0 {IMG_W} {IMG_H}" '
                f'preserveAspectRatio="xMidYMid {fit}">'
                f'<image width="{IMG_W}" height="{IMG_H}" xlink:href="../images/{img_name}"/>'
                f'</svg></body></html>\n')

    manifest, spine = [], []
    for idx, (img_name, _) in enumerate(pages):
        pid = f"pg{idx+1}"
        manifest.append(f'    <item id="{pid}" href="text/{pid}.xhtml" media-type="application/xhtml+xml"/>')
        manifest.append(f'    <item id="img{idx+1}" href="images/{img_name}" media-type="image/png"/>')
        props = ' properties="rendition:page-spread-center"'
        spine.append(f'    <itemref idref="{pid}"{props}/>')
    # cover image = first page
    cover_img = pages[0][0]

    # Clickable TOC from the PDF outline (surah -> the page it starts on). Each
    # entry links to the matching page XHTML, so Kobo's Table-of-Contents menu
    # jumps straight to any surah. (The page images themselves aren't hyperlinked
    # — a pre-paginated image book navigates through this nav, not in-page taps.)
    toc_items, ncx_points = [], []
    for lvl, title, pg in doc.get_toc():
        if pg > n:
            continue
        # keep every outline level (group headers like "Juz 30" / "Dzikir Pagi"
        # AND the items), each one clickable; sub-levels get a small indent.
        indent = '&#160;&#160;' * (lvl - 1)
        toc_items.append(f'<li><a href="text/pg{pg}.xhtml">{indent}{esc(title)}</a></li>')
        ncx_points.append((title, pg))
    if not toc_items:
        toc_items.append('<li><a href="text/pg1.xhtml">Mulai</a></li>')
    nav = ('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
           '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n'
           '<head><meta charset="utf-8"/><title>Daftar Isi</title></head>\n'
           '<body><nav epub:type="toc" id="toc" role="doc-toc"><h1>Daftar Isi</h1>\n'
           '<ol>' + "\n".join(toc_items) + '</ol></nav>\n'
           '<nav epub:type="landmarks" hidden="hidden"><ol>'
           '<li><a epub:type="cover" href="text/pg1.xhtml">Cover</a></li>'
           '<li><a epub:type="toc" href="nav.xhtml">Daftar Isi</a></li>'
           '<li><a epub:type="bodymatter" href="text/pg1.xhtml">Begin</a></li>'
           '</ol></nav></body></html>\n')

    # EPUB2 toc.ncx too — some Kobo paths read it for the TOC menu.
    navpoints = "\n".join(
        f'    <navPoint id="np{i+1}" playOrder="{i+1}"><navLabel><text>{esc(t)}</text></navLabel>'
        f'<content src="text/pg{pg}.xhtml"/></navPoint>'
        for i, (t, pg) in enumerate(ncx_points))
    ncx = (f'<?xml version="1.0" encoding="utf-8"?>\n'
           f'<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
           f'  <head><meta name="dtb:uid" content="{UID}"/></head>\n'
           f'  <docTitle><text>{esc(title)}</text></docTitle>\n'
           f'  <navMap>\n{navpoints}\n  </navMap>\n</ncx>\n')

    opf = (f'<?xml version="1.0" encoding="utf-8"?>\n'
           f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" '
           f'prefix="rendition: http://www.idpf.org/vocab/rendition/#">\n'
           f'  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
           f'    <dc:identifier id="pub-id">{UID}</dc:identifier>\n'
           f'    <dc:title>{esc(title)}</dc:title>\n'
           f'    <dc:language>ar</dc:language>\n'
           f'    <dc:creator>Al-Qur’an al-Karim</dc:creator>\n'
           f'    <dc:publisher>quran-epub-builder</dc:publisher>\n'
           f'    <meta property="dcterms:modified">{MOD}</meta>\n'
           f'    <meta name="cover" content="img1"/>\n'
           f'    <meta property="rendition:layout">pre-paginated</meta>\n'
           f'    <meta property="rendition:orientation">portrait</meta>\n'
           f'    <meta property="rendition:spread">none</meta>\n'
           f'  </metadata>\n'
           f'  <manifest>\n'
           f'    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n'
           f'    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n'
           + "\n".join(manifest) + "\n"
           f'  </manifest>\n'
           f'  <spine toc="ncx">\n' + "\n".join(spine) + "\n  </spine>\n"
           f'  <guide>\n'
           f'    <reference type="cover" title="Cover" href="text/pg1.xhtml"/>\n'
           f'    <reference type="toc" title="Daftar Isi" href="nav.xhtml"/>\n'
           f'    <reference type="text" title="Begin" href="text/pg1.xhtml"/>\n'
           f'  </guide>\n'
           f'</package>\n')

    container = ('<?xml version="1.0" encoding="utf-8"?>\n'
                 '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
                 '  <rootfiles>\n'
                 '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n'
                 '  </rootfiles>\n</container>\n')

    with zipfile.ZipFile(out_path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", ncx, compress_type=zipfile.ZIP_DEFLATED)
        for idx, (img_name, jpg) in enumerate(pages):
            z.writestr(f"OEBPS/images/{img_name}", jpg, compress_type=zipfile.ZIP_STORED)
            fit = "slice" if idx == 0 else "meet"   # cover = full-bleed, pages = fit
            z.writestr(f"OEBPS/text/pg{idx+1}.xhtml", page_xhtml(img_name, fit), compress_type=zipfile.ZIP_DEFLATED)

    import os
    mb = os.path.getsize(out_path) / 1048576
    print(f"OK: {out_path}  ({n} pages, {IMG_W}x{IMG_H}px, {mb:.1f} MB)")

if __name__ == "__main__":
    src, out, title = sys.argv[1], sys.argv[2], sys.argv[3]
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    width = int(sys.argv[5]) if len(sys.argv) > 5 else 1072
    colors = int(sys.argv[6]) if len(sys.argv) > 6 else 16
    build(src, out, title, limit, width, colors)
