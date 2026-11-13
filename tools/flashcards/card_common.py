"""
Shared engine for the Orton-Gillingham flashcard generators.

Cards are built as inline SVG inside one self-contained HTML file (font embedded),
then Chromium (Playwright) prints it to a PDF (one card per page) and/or
screenshots each card to a PNG. Chromium is used because it applies the font's
contextual joining, so multi-letter cursive words connect correctly.

One-time setup:
    pip install playwright fonttools
    playwright install chromium
"""
import argparse
import base64
import html
import re
import sys
import urllib.request
from pathlib import Path

FONT_NAME = "PlaywriteCO[wght].ttf"
FONT_URL = ("https://github.com/google/fonts/raw/main/ofl/playwriteco/"
            "PlaywriteCO%5Bwght%5D.ttf")

# ---------------------------------------------------------------------------
# Card geometry, in SVG user units (measured from your example PDFs).
#   lines    = y-centres of the 4 writing lines (top, x-height, baseline, descender)
#   line_w   = thickness of each writing line
#   size_in  = physical card size in inches (width, height)
# ---------------------------------------------------------------------------
LAYOUTS = {
    "skills": dict(W=896, H=1345, size_in=(4, 6),
                   lines=[110, 425, 721, 1037], line_w=32,
                   num_font=75, num_pad_x=70, num_y=1295),
    "jailbirds": dict(W=864, H=576, size_in=(6, 4),
                      lines=[95, 225, 347, 478], line_w=13, border=False,
                      num_font=40, num_pad_x=60, num_y=545),
}

# Skill category -> text colour. Edit freely.
RED = "#990000"
CATEGORY_COLORS = {
    "V":  RED,        # simple vowel (same red as jailbirds)
    "C":  "#000000",  # simple consonant
    "DG": "#0b1a6b",  # digraph: dark blue (between black and blue)
    "P":  "#c21f1f",  # vowel pair: slightly lighter red
    "B":  "#2f5fd9",  # consonant blend: royal blue
    "T":  "#4b1a7a",  # trigraph: dark purple
    "DP": "#ff4f9a",  # diphthong: pink
}
NUM_GREY = "#555555"  # lesson-number colour for skills cards
JAILBIRD_COLOR = RED

TEXT_BASELINE_NUDGE = 0.0  # fraction of x-height; tweak if glyphs sit high/low on lines
TRACE_FILL = "#ffffff"    # tracing mode: white letters (for colouring in) ...
TRACE_OUTLINE_FRAC = 0.04  # ... with a coloured outline this thick (fraction of x-height)
STROKE_FRAC = 0.034        # faux-bold stroke width as a fraction of x-height
MAX_FRAC = 0.84            # card content never wider than this fraction of card width


def ensure_font(font_path=None):
    """Return a path to Playwrite CO (fonts/ folder next to this script); download if missing."""
    here = Path(__file__).resolve().parent
    if font_path:
        if Path(font_path).exists():
            return Path(font_path)
        raise SystemExit(f"ERROR: font file not found: {font_path}")
    # also look in the game's own font folder (client/public/fonts), so the two projects share ONE copy
    for folder in (here / "fonts", here, here.parent.parent / "client" / "public" / "fonts"):
        for c in sorted(folder.glob("PlaywriteCO*.ttf")):
            return c
    target = here / "fonts" / FONT_NAME
    target.parent.mkdir(exist_ok=True)
    print(f"Font not found - trying to download it to {target}")
    try:
        urllib.request.urlretrieve(FONT_URL, str(target))
        return target
    except Exception as e:
        raise SystemExit(
            "ERROR: the Playwrite CO font file is missing and could not be downloaded "
            f"({e.__class__.__name__}).\n"
            "Fix: put the file  PlaywriteCO[wght].ttf  inside the 'fonts' folder that sits next to "
            "these scripts (it is included in flashcard_kit.zip).")


def x_height_ratio(font_file):
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(str(font_file))
        return f["OS/2"].sxHeight / f["head"].unitsPerEm
    except Exception:
        return 0.5  # Playwrite CO's value


def lesson_from_filename(path):
    """skills_01.txt -> 1 ; Jailbirds_12.txt -> 12"""
    m = re.findall(r"\d+", Path(path).stem)
    return int(m[-1]) if m else None


def parse_rows(path, kind):
    """Yield dicts per non-blank line. skills: grapheme, category, count. jailbirds: word."""
    rows = []
    for n, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if kind == "jailbirds":
            # "word"  or  "word, lesson"  - a lesson number on the line overrides the filename's
            parts = [p.strip() for p in line.split(",")]
            row = dict(text=parts[0])
            if len(parts) > 1 and parts[1]:
                if parts[1].isdigit():
                    row["lesson"] = int(parts[1])
                else:
                    print(f"  warning: line {n} ({raw!r}): lesson {parts[1]!r} is not a number; "
                          "using the filename's lesson", file=sys.stderr)
            rows.append(row)
            continue
        parts = [p.strip() for p in line.split(",")]
        text = parts[0]
        cat = (parts[1] if len(parts) > 1 else "").upper().replace(" ", "")
        count = parts[2] if len(parts) > 2 else ""
        if not text:
            continue
        if cat not in CATEGORY_COLORS:
            print(f"  warning: line {n} ({raw!r}): unknown category {cat!r}, using black",
                  file=sys.stderr)
        row = dict(text=text, cat=cat, count=count)
        # 4th column = position (I/M/F, used by the game to choose the pile; the printed card ignores it)
        # 5th column = lesson number for this card (overrides the filename's lesson)
        if len(parts) > 4 and parts[4].isdigit():
            row["lesson"] = int(parts[4])
        rows.append(row)
    return rows


def card_svg(kind, row, lesson, lay, fs, stroke, border=True, lines=True, trace=False):
    lesson = row.get("lesson", lesson)   # per-card lesson (jailbirds "word, 3") beats the filename
    W, H = lay["W"], lay["H"]
    ys = lay["lines"]
    xspan = ys[2] - ys[1]
    base = ys[2] + TEXT_BASELINE_NUDGE * xspan

    if kind == "jailbirds":
        color, num_color = JAILBIRD_COLOR, "#000000"
        num_anchor, num_x = "end", W - lay["num_pad_x"] + 20
        corner = ""
    else:
        color = CATEGORY_COLORS.get(row["cat"], "#000000")
        num_color = NUM_GREY
        num_anchor, num_x = "end", W - lay["num_pad_x"] + 20  # lesson # bottom-RIGHT (matches example PDF)
        corner = ""
        if row["count"]:
            corner = (f'<text x="{lay["num_pad_x"]}" y="{lay["num_font"] + 40}" '
                      f'font-family="Times New Roman, Times, serif" '
                      f'font-size="{lay["num_font"]}" fill="{color}">'
                      f'{html.escape(row["count"])}</text>')

    rules = ""
    if lines:
        rules = "".join(
            f'<rect class="rule" x="0" y="{y - lay["line_w"] / 2}" width="10" '
            f'height="{lay["line_w"]}" fill="{color}"/>' for y in ys)
    txt = html.escape(row["text"])
    common = (f'x="{W / 2}" y="{base}" text-anchor="middle" font-family="PlaywriteCO, cursive" '
              f'font-weight="400" font-size="{fs}"')
    if trace:
        # Tracing letters: coloured outline layer underneath, white fill on top.
        # (Two layers hide the little overlaps where cursive letters join.)
        ow = 2 * TRACE_OUTLINE_FRAC * xspan
        glyph = (f'<text class="glyph" {common} fill="{color}" stroke="{color}" '
                 f'stroke-width="{ow:.2f}" stroke-linejoin="round">{txt}</text>'
                 f'<text {common} fill="{TRACE_FILL}">{txt}</text>')
    else:
        glyph = (f'<text class="glyph" {common} fill="{color}" stroke="{color}" '
                 f'stroke-width="{stroke}" stroke-linejoin="round" paint-order="stroke">{txt}</text>')

    frame = (f'<rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="{min(W, H) * 0.065}" '
             f'fill="#fff" stroke="#666" stroke-width="2"/>') if (border and lay.get("border", True)) else ""
    num = ""
    if lesson is not None:
        num = (f'<text x="{num_x}" y="{lay["num_y"]}" text-anchor="{num_anchor}" '
               f'font-family="Times New Roman, Times, serif" font-size="{lay["num_font"]}" '
               f'fill="{num_color}">{lesson}</text>')

    return f"""
<section class="card">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" data-w="{W}" data-cy="{(ys[0] + ys[3]) / 2}">
  {frame}
  <g class="content">
    {rules}
    {glyph}
  </g>
  {corner}
  {num}
</svg>
</section>"""


def build_html(kind, rows, lesson, font_file, border=True, lines=True, trace=False):
    lay = LAYOUTS[kind]
    xspan = lay["lines"][2] - lay["lines"][1]
    fs = xspan / x_height_ratio(font_file)
    stroke = xspan * STROKE_FRAC
    wi, hi = lay["size_in"]
    font_b64 = base64.b64encode(Path(font_file).read_bytes()).decode()
    cards = "\n".join(card_svg(kind, r, lesson, lay, fs, stroke, border, lines, trace) for r in rows)
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{kind} {lesson}</title>
<style>
@font-face {{ font-family: PlaywriteCO; font-weight: 100 400;
  src: url(data:font/ttf;base64,{font_b64}) format("truetype"); }}
@page {{ size: {wi}in {hi}in; margin: 0; }}
html, body {{ margin: 0; padding: 0; background: #fff; }}
.card {{ width: {wi}in; height: {hi}in; page-break-after: always; break-after: page;
  overflow: hidden; }}
.card svg {{ width: 100%; height: 100%; display: block; }}
@media screen {{ body {{ background: #ddd; display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; }}
  .card {{ page-break-after: auto; }} }}
</style></head><body>
{cards}
<script>
// Once the font is loaded: size writing lines to the word/grapheme width,
// and shrink the whole line+text group if it would overflow the card.
document.fonts.load('400 100px PlaywriteCO').then(() => document.fonts.ready).then(() => {{
  document.querySelectorAll('.card svg').forEach(svg => {{
    const W = +svg.dataset.w, cy = +svg.dataset.cy;
    const g = svg.querySelector('.content');
    const t = svg.querySelector('.glyph');
    const bb = t.getBBox();
    const pad = {lay["line_w"]} * 1.1;
    const lw = bb.width + 2 * pad;
    svg.querySelectorAll('.rule').forEach(r => {{
      r.setAttribute('x', W / 2 - lw / 2); r.setAttribute('width', lw); }});
    const s = Math.min(1, W * {MAX_FRAC} / lw);
    if (s < 1) g.setAttribute('transform',
      `translate(${{W/2}} ${{cy}}) scale(${{s}}) translate(${{-W/2}} ${{-cy}})`);
  }});
  document.body.dataset.ready = '1';
}});
</script></body></html>"""


def render(html_text, out_base, want_pdf, want_png, want_html, png_scale=2):
    try:
        import playwright  # noqa: F401
        have_pw = True
    except Exception:
        have_pw = False
    if (want_pdf or want_png) and not have_pw:
        print("  (Playwright not installed - writing HTML only; see instructions below)")
        want_pdf = want_png = False
        want_html = True
    if want_html:
        Path(f"{out_base}.html").write_text(html_text, encoding="utf-8")
        print(f"  wrote {out_base}.html")
    if not (want_pdf or want_png):
        return
    try:
        from playwright.sync_api import sync_playwright
        pw_cm = sync_playwright()
        p = pw_cm.start()
        browser = p.chromium.launch()
    except Exception as e:
        print(f"  Could not start Chromium ({e.__class__.__name__}); writing HTML only.")
        Path(f"{out_base}.html").write_text(html_text, encoding="utf-8")
        print(f"  wrote {out_base}.html")
        return
    if True:
        page = browser.new_page(device_scale_factor=png_scale)
        page.set_content(html_text)
        page.wait_for_selector("body[data-ready='1']")
        if want_pdf:
            page.pdf(path=f"{out_base}.pdf", prefer_css_page_size=True,
                     print_background=True)
            print(f"  wrote {out_base}.pdf")
        if want_png:
            png_dir = Path(f"{out_base}_png")
            png_dir.mkdir(exist_ok=True)
            page.emulate_media(media="print")
            cards = page.locator(".card")
            for i in range(cards.count()):
                cards.nth(i).screenshot(path=str(png_dir / f"{i + 1:03d}.png"))
            print(f"  wrote {cards.count()} PNGs in {png_dir}/")
        browser.close()
        p.stop()


def main(kind):
    ap = argparse.ArgumentParser(description=f"Generate {kind} flashcards from .txt files")
    ap.add_argument("inputs", nargs="+", help=f"e.g. {kind}_01.txt (lesson # comes from filename)")
    ap.add_argument("-o", "--outdir", default=None, help="output folder (default: next to input)")
    ap.add_argument("--png", action="store_true", help="also write one PNG per card")
    ap.add_argument("--html", action="store_true", help="also keep the HTML")
    ap.add_argument("--html-only", action="store_true",
                    help="just write the HTML (open it in Chrome/Safari and print to PDF)")
    ap.add_argument("--no-pdf", action="store_true", help="skip the PDF")
    ap.add_argument("--no-lines", action="store_true", help="omit the writing lines")
    ap.add_argument("--no-border", action="store_true", help="omit the rounded card outline")
    ap.add_argument("--trace", action="store_true",
                    help="tracing letters: white fill with a coloured outline (for colouring in)")
    ap.add_argument("--font", default=None, help="path to PlaywriteCO[wght].ttf")
    a = ap.parse_args()

    font = ensure_font(a.font)
    for inp in a.inputs:
        lesson = lesson_from_filename(inp)
        rows = parse_rows(inp, kind)
        print(f"{inp}: lesson {lesson}, {len(rows)} cards")
        if not rows:
            continue
        outdir = Path(a.outdir) if a.outdir else Path(inp).resolve().parent
        outdir.mkdir(parents=True, exist_ok=True)
        base = outdir / Path(inp).stem
        doc = build_html(kind, rows, lesson, font, not a.no_border, not a.no_lines, a.trace)
        if a.html_only:
            render(doc, base, False, False, True)
        else:
            render(doc, base, not a.no_pdf, a.png, a.html)


if __name__ == "__main__":
    # Lets you run:  python3 card_common.py skills_01.txt --html-only
    # The card type is taken from the first filename (skills_... or jailbirds_...).
    if len(sys.argv) < 2:
        sys.exit("Usage: python3 card_common.py skills_NN.txt [more ...] [--html-only ...]")
    _stem = Path(sys.argv[1]).stem.lower()
    if _stem.startswith("skills"):
        main("skills")
    elif _stem.startswith("jailbirds"):
        main("jailbirds")
    else:
        sys.exit("First filename must start with skills_ or jailbirds_")
