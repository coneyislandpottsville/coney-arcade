"""Derive the chapter screenshot stubs from the masters in .tmp (never committed).

    python tools/derive-shots.py

Writes src/img/shots/<game>-<n>-<width>.avif and .webp, cropped to 16:9.
Trivia has no gameplay screenshots in the library, so its stubs are frames
pulled from the take the trailer was cut from.
"""

import subprocess
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / ".tmp"
OUT = ROOT / "src" / "img" / "shots"
TAKE = TMP / "gameplay" / "trivia-gameplay-video-masters" / "trivia-bowl-final-1920x1080.mp4"

WIDTHS = (480, 720, 960)

# (source, crop) per stub, the crop in fractions of the master; a float source
# is a second into the trivia take. The stubs are small, so each is punched in
# past the page margins to whatever the shot is actually about.
SHOTS = {
    "maze": [
        (TMP / "maze/screenshots/web-desktop-play.jpg", (0.10, 0.02, 0.90, 1.00)),
        (TMP / "maze/screenshots/desktop-level15.jpg", (0.14, 0.04, 0.88, 1.00)),
        (TMP / "maze/screenshots/web-desktop-title.jpg", (0.10, 0.02, 0.90, 1.00)),
    ],
    "slots": [
        (TMP / "tiki/screenshots/three-match-desktop.png", None),
        (TMP / "tiki/screenshots/bonus-grill-desktop.png", None),
        (TMP / "tiki/screenshots/paytable-desktop.png", None),
        (TMP / "tiki/screenshots/three-wilds-desktop.png", None),
    ],
    "trivia": [
        (9.55, (0.32, 0.12, 1.00, 0.88)),
        (19.95, (0.36, 0.02, 1.00, 0.88)),
        (89.00, (0.36, 0.08, 1.00, 0.97)),
    ],
}


def load(src) -> Image.Image:
    if isinstance(src, (int, float)):
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", str(src), "-i", str(TAKE),
             "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
            check=True, capture_output=True,
        ).stdout
        return Image.open(BytesIO(raw)).convert("RGB")
    return Image.open(src).convert("RGB")


def punch(im: Image.Image, box) -> Image.Image:
    if box is None:
        return im
    left, top, right, bottom = box
    return im.crop((round(left * im.width), round(top * im.height),
                    round(right * im.width), round(bottom * im.height)))


def crop_169(im: Image.Image) -> Image.Image:
    want = im.width * 9 / 16
    if im.height > want:  # taller than 16:9, trim evenly top and bottom
        top = round((im.height - want) / 2)
        return im.crop((0, top, im.width, top + round(want)))
    wide = round(im.height * 16 / 9)
    left = round((im.width - wide) / 2)
    return im.crop((left, 0, left + wide, im.height))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for game, sources in SHOTS.items():
        for n, (src, box) in enumerate(sources, 1):
            master = crop_169(punch(load(src), box))
            for w in WIDTHS:
                im = master.resize((w, round(w * 9 / 16)), Image.LANCZOS)
                im.save(OUT / f"{game}-{n}-{w}.avif", quality=58, speed=2)
                im.save(OUT / f"{game}-{n}-{w}.webp", quality=80, method=6)
            print(f"{game}-{n}: {master.width}x{master.height}")


if __name__ == "__main__":
    main()
