"""Add a PDF outline (bookmarks) using PyMuPDF.

Chrome's --print-to-pdf emits named destinations for in-page anchor links but no
document outline. The official Xteink PDF->.xtcz converter builds the chapter
list from the PDF outline, so without one the .xtcz has no chapters ("content
tidak bisa terlist"). This resolves each chapter's named destination to a page
and writes a flat outline.

Usage: python add-pdf-outline.py <pdf> <items.json>
  items.json = [{"name": "pdfnav-7", "title": "Surah An-Nas"}, ...] in order.
"""

import json
import sys

import fitz  # PyMuPDF


def main():
    pdf_path, json_path = sys.argv[1], sys.argv[2]
    with open(json_path, encoding="utf-8") as fh:
        items = json.load(fh)

    doc = fitz.open(pdf_path)
    names = doc.resolve_names()  # {name: {"page": 0-based, ...}}

    toc = []
    missing = 0
    for item in items:
        info = names.get(item["name"])
        if not info or info.get("page") is None:
            missing += 1
            continue
        level = item.get("level", 1)
        # set_toc requires levels to start at 1 and never jump by more than 1.
        if not toc:
            level = 1
        elif level > toc[-1][0] + 1:
            level = toc[-1][0] + 1
        toc.append([level, item["title"], info["page"] + 1])  # page is 1-based

    if not toc:
        print(f"no resolvable destinations ({missing} missing)")
        return

    doc.set_toc(toc)
    # Incremental save keeps Chrome's original bytes intact and just appends.
    doc.save(pdf_path, incremental=True, encryption=fitz.PDF_ENCRYPT_KEEP)
    doc.close()
    note = f" ({missing} unresolved)" if missing else ""
    print(f"{len(toc)} bookmarks{note}")


if __name__ == "__main__":
    main()
