#!/usr/bin/env python3
"""Build the dsh-launcher icon set from the official deepseek-harness whale logo.

The black whale mark comes from apps/web/public/favicon.svg (in the
deepseek-harness checkout). This script only packages that official mark onto
two rounded-square cards — no redesigned artwork:

  whale       — black whale on a white card (the official light-mode look)
  whale-dark  — white whale on a dark card

Only 1024px PNGs are emitted: the plugin generates the macOS .icns at install
time with the built-in `sips` + `iconutil`, so no .icns is stored in the repo
(keeps the package ~190 KB).

Requires: Python 3 + Pillow, macOS `sips` (for SVG rasterization).

Usage: python3 scripts/build-icons.py /path/to/deepseek-harness/apps/web/public/favicon.svg
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "icons")

S = 4096          # supersample canvas
FINAL = 1024      # final icon size
SS = S // FINAL   # supersample factor
R = 0.224         # corner radius fraction

CARD_BORDER = (228, 231, 235)   # #E4E7EB
DARK_CARD = (24, 26, 32, 255)   # #181A20
DARK_BORDER = (45, 52, 68)      # #2D3444


def rasterize(svg_path: str, size: int, out_png: str) -> None:
    """Rasterize an SVG at `size` via macOS sips (native vector render)."""
    subprocess.run(
        ["sips", "-z", str(size), str(size), "-s", "format", "png", svg_path, "--out", out_png],
        check=True,
        capture_output=True,
    )


def invert(black: Image.Image) -> Image.Image:
    """White-on-transparent variant of the black whale mark."""
    px = black.load()
    out = Image.new("RGBA", black.size)
    op = out.load()
    for y in range(black.height):
        for x in range(black.width):
            r, g, b, a = px[x, y]
            if a > 0:
                lum = (r + g + b) / 3
                inv = 255 - int(lum * 0.9)
                op[x, y] = (inv, inv, inv, a)
            else:
                op[x, y] = (0, 0, 0, 0)
    return out


def card(fill, border, logo: Image.Image) -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * R), fill=fill)
    d.rounded_rectangle([2, 2, S - 3, S - 3], radius=int(S * R) - 2, outline=border, width=max(3, S // 700))
    w = int(FINAL * 0.60)
    h = int(logo.height * w / logo.width)
    logo = logo.resize((w * SS, h * SS), Image.LANCZOS)
    x = (S - logo.width) // 2
    y = (S - logo.height) // 2
    img.alpha_composite(logo, (x, y))
    return img


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    svg = sys.argv[1]
    if not os.path.exists(svg):
        print(f"favicon.svg not found: {svg}")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        black_png = os.path.join(tmp, "black-1024.png")
        rasterize(svg, FINAL, black_png)
        black = Image.open(black_png).convert("RGBA")
        white = invert(black)

    for name, builder in (
        ("whale", lambda: card((255, 255, 255, 255), CARD_BORDER, black)),
        ("whale-dark", lambda: card(DARK_CARD, DARK_BORDER, white)),
    ):
        img = builder().resize((FINAL, FINAL), Image.LANCZOS)
        img.save(os.path.join(OUT_DIR, f"{name}.png"))
        print(f"built {name}.png")


if __name__ == "__main__":
    main()
