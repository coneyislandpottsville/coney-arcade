"""Derive the ticket card images from the poster masters in .tmp (never committed).

    python tools/derive-images.py

Writes src/img/<game>-<width>.avif and .webp for every width in the srcset.
The favicon, touch icon and OG image come from tools/social/render.cjs.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / ".tmp" / "poster" / "cards"
IMG = ROOT / "src" / "img"

GAMES = ("maze", "tiki", "trivia", "sharp-mountain")
WIDTHS = (480, 720, 960, 1200, 1440, 1920)


def main() -> None:
    Image.MAX_IMAGE_PIXELS = None
    IMG.mkdir(parents=True, exist_ok=True)
    for game in GAMES:
        master = Image.open(CARDS / f"{game}-card-4500.png").convert("RGB")
        for w in WIDTHS:
            h = round(w * 630 / 1200)
            im = master.resize((w, h), Image.LANCZOS)
            im.save(IMG / f"{game}-{w}.avif", quality=58, speed=2)
            im.save(IMG / f"{game}-{w}.webp", quality=80, method=6)
            print(f"{game}-{w}: {w}x{h}")


if __name__ == "__main__":
    main()
