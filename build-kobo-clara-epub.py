#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build-kobo-clara-epub.py — post-process a Universal reflow EPUB into a clean,
Kobo-Clara-ready reflow EPUB that the user can kepubify themselves.

Guarantees for a sideloaded Kobo import:
  * mimetype is the first entry and STORED (OCF).
  * NO DRM markers — any META-INF/encryption.xml or rights.xml is dropped,
    and no Adobe ADEPT metadata is added.
  * complete metadata — <meta name="cover"> + an EPUB2 <guide> (cover/toc/text)
    so the book shows in the Kobo library and opens (not greyed as "DRM").
  * optional Arabic-font swap (Scheherazade breaks on Clara reflow; Amiri Quran
    renders correctly) and an optional embedded cover image.
  * Kobo-UI safe labels — the library/TOC chrome has NO Arabic font, so the
    dc:title is forced to a Latin one (--title) and the Arabic juz segment is
    stripped from nav/NCX labels ("Juz 3 — الجزء ٣" -> "Juz 3"); dual dc:title
    (a known Kobo import breaker) is collapsed to one.
  * bismillah -> the one-codepoint basmala ligature U+FDFD (present in Amiri
    Quran), so kepubify spans / the Kobo engine can never split it mid-word.
  * .ayah-num gets the full pill rule (cream bg + ring + radius) — the base
    rule is lost in some editions, leaving bare digits with no motif.

  python build-kobo-clara-epub.py <src.epub> <out.epub> \
      [--swap OLD.ttf NEW.ttf] [--cover cover.jpg] [--title "Latin Title"]
"""
import sys, os, re, zipfile, argparse

BASMALA = "﷽"  # ﷽ ARABIC LIGATURE BISMILLAH...

# Full pill restored for the ayah marker + readable size for the basmala glyph.
KOBO_CSS_APPEND = (
    "\n/* === Kobo Clara optim (build-kobo-clara-epub.py) === */\n"
    ".ayah-num{display:inline-block;box-sizing:content-box;min-width:1.05em;"
    "padding:.06em .4em;margin:0 .3em;font-size:.6em;line-height:1.2;"
    "text-align:center;vertical-align:middle;white-space:nowrap;color:#2f3e2f;"
    "background:#f7f3e8;border:1.5px solid #879486;border-radius:1.4em;}\n"
    ".bismillah{font-size:1.9em !important;line-height:1.6 !important;}\n"
)

def latinize_toc(text):
    """Strip the Arabic juz segment from TOC labels (tofu in the Kobo UI)."""
    return re.sub(r"(Juz \d+)\s*—[^<]*", r"\1", text)

def set_latin_title(opf, title):
    """Collapse every dc:title into ONE Latin title (Kobo UI has no Arabic)."""
    opf = re.sub(r"\s*<dc:title\b[^>]*>[^<]*</dc:title>", "", opf)
    return opf.replace(
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
        f"    <dc:title>{title}</dc:title>", 1)

def find_opf(z):
    cont = z.read("META-INF/container.xml").decode("utf-8", "replace")
    m = re.search(r'full-path="([^"]+)"', cont)
    return m.group(1)

def ensure_meta_cover(opf, cover_id):
    if re.search(r'name="cover"', opf):
        return opf
    return opf.replace("</metadata>",
        f'    <meta name="cover" content="{cover_id}"/>\n  </metadata>')

def ensure_guide(opf, opf_dir, cover_href, toc_href, text_href):
    if "<guide>" in opf:
        return opf
    def rel(h):  # hrefs in the OPF manifest are already relative to the OPF
        return h
    guide = ("  <guide>\n"
             f'    <reference type="cover" title="Cover" href="{rel(cover_href)}"/>\n'
             f'    <reference type="toc" title="Daftar Isi" href="{rel(toc_href)}"/>\n'
             f'    <reference type="text" title="Begin" href="{rel(text_href)}"/>\n'
             "  </guide>\n")
    return opf.replace("</package>", guide + "</package>")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--swap", nargs=2, metavar=("OLD", "NEW"))
    ap.add_argument("--cover")
    ap.add_argument("--title", default="Al-Qur'an al-Karim",
                    help="Latin dc:title (Kobo library UI has no Arabic font)")
    a = ap.parse_args()

    zin = zipfile.ZipFile(a.src)
    opf_path = find_opf(zin)
    opf_dir = os.path.dirname(opf_path)
    opf = zin.read(opf_path).decode("utf-8", "replace")

    # manifest id->href and href list
    items = dict(re.findall(r'<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"', opf))
    id_by_prop = {}
    for m in re.finditer(r'<item\b([^>]*)/?>', opf):
        attrs = m.group(1)
        hid = (re.search(r'id="([^"]+)"', attrs) or [None, None])[1]
        href = (re.search(r'href="([^"]+)"', attrs) or [None, None])[1]
        props = (re.search(r'properties="([^"]+)"', attrs) or [None, ""])[1]
        if props and hid:
            id_by_prop[props] = (hid, href)

    extra_files = {}        # new files to add (path -> bytes)
    new_font = None

    # --- optional font swap (file + every CSS/OPF reference) ---
    if a.swap:
        old_font, new_font_path = a.swap
        new_font = os.path.basename(new_font_path)
        if not os.path.exists(new_font_path):
            sys.exit(f"font not found: {new_font_path}")
        extra_files_font = open(new_font_path, "rb").read()

    # --- optional cover image ---
    cover_id = None
    if a.cover:
        if not os.path.exists(a.cover):
            sys.exit(f"cover not found: {a.cover}")
        ext = os.path.splitext(a.cover)[1].lower()
        mt = "image/png" if ext == ".png" else "image/jpeg"
        cover_rel = f"images/cover{ext}"
        cover_full = (opf_dir + "/" + cover_rel) if opf_dir else cover_rel
        extra_files[cover_full] = open(a.cover, "rb").read()
        cover_id = "cover-image"
        if 'id="cover-image"' not in opf:
            opf = opf.replace("</manifest>",
                f'    <item id="cover-image" href="{cover_rel}" media-type="{mt}" properties="cover-image"/>\n  </manifest>')
    else:
        # reuse an existing cover-image item if present
        if "cover-image" in id_by_prop:
            cover_id = id_by_prop["cover-image"][0]
        else:
            m = re.search(r'name="cover"\s+content="([^"]+)"', opf)
            cover_id = m.group(1) if m else None

    if cover_id:
        opf = ensure_meta_cover(opf, cover_id)

    # --- <guide> (cover / toc / first text) ---
    # cover page = epub:type cover item, else first spine item
    spine = re.findall(r'<itemref\b[^>]*\bidref="([^"]+)"', opf)
    cover_href = items.get("cover") or (items.get(spine[0]) if spine else None)
    nav_item = id_by_prop.get("nav")
    toc_href = (nav_item[1] if nav_item else None) or items.get("nav") or items.get("toc") or cover_href
    # first text = first spine doc that isn't cover/nav
    text_href = cover_href
    for sid in spine:
        if sid not in ("cover", "nav") and items.get(sid, "").endswith((".xhtml", ".html")):
            text_href = items[sid]; break
    if cover_href and toc_href and text_href:
        opf = ensure_guide(opf, opf_dir, cover_href, toc_href, text_href)

    # Kobo-UI fixes on the OPF itself:
    #  * single Latin dc:title (Arabic title = tofu; dual dc:title breaks import)
    #  * the font swap must ALSO hit the manifest href — the OPF is written from
    #    this pre-built string, so the generic swap below never reaches it (this
    #    was the bug that left the manifest pointing at the removed old font).
    opf = set_latin_title(opf, a.title)
    if a.swap:
        opf = opf.replace(old_font, new_font)

    # --- write output (drop DRM, swap font refs, mimetype first+stored) ---
    with zipfile.ZipFile(a.out, "w") as zout:
        zout.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        for n in zin.namelist():
            if n == "mimetype":
                continue
            if n.endswith(("encryption.xml", "rights.xml")):   # strip any DRM markers
                continue
            data = zin.read(n)
            if a.swap and new_font and re.search(r'fonts/' + re.escape(old_font) + r'$', n):
                continue  # skip the old font file; the new one is added below
            if n == opf_path:
                data = opf.encode("utf-8")
            elif n.endswith((".css", ".opf", ".xhtml", ".html", ".ncx")):
                text = data.decode("utf-8", "replace")
                if a.swap:
                    text = text.replace(old_font, new_font)
                if n.endswith((".ncx",)) or n.endswith("nav.xhtml"):
                    text = latinize_toc(text)   # Arabic juz label = tofu in Kobo UI
                elif n.endswith((".xhtml", ".html")):
                    # one-glyph basmala: kepubify spans can't split it mid-word
                    text = re.sub(r'(class="bismillah"[^>]*>)[^<]+(</)',
                                  lambda m: m.group(1) + BASMALA + m.group(2), text)
                if n.endswith(".css"):
                    text += KOBO_CSS_APPEND     # ayah pill + basmala size
                data = text.encode("utf-8")
            zout.writestr(n, data, compress_type=zipfile.ZIP_DEFLATED)
        if a.swap:
            zout.writestr(f"{opf_dir}/fonts/{new_font}" if opf_dir else f"fonts/{new_font}",
                          extra_files_font, compress_type=zipfile.ZIP_DEFLATED)
        for path, blob in extra_files.items():
            zout.writestr(path, blob, compress_type=zipfile.ZIP_DEFLATED)

    mb = os.path.getsize(a.out) / 1048576
    # sanity re-read
    zc = zipfile.ZipFile(a.out)
    names = zc.namelist()
    opf2 = zc.read(opf_path).decode("utf-8", "replace")
    ok = (names[0] == "mimetype" and zc.getinfo("mimetype").compress_type == 0
          and not any(x.endswith(("encryption.xml", "rights.xml")) for x in names)
          and "<guide>" in opf2 and 'name="cover"' in opf2)
    print(f"{'OK' if ok else 'WARN'}: {a.out} ({mb:.1f} MB) "
          f"guide={'<guide>' in opf2} cover-meta={'name=\"cover\"' in opf2} "
          f"drm={'yes' if any(x.endswith(('encryption.xml','rights.xml')) for x in names) else 'none'} "
          f"font={new_font or '(unchanged)'}")

if __name__ == "__main__":
    main()
