"""Derive the /3d page's images from the masters in .tmp (never committed).

    python tools/derive-3d.py

Writes the studio renders with alpha and the app icon to src/3d/img/, public/og-3d.v2.jpg from the
client's own share card, and the heavy sets (one still per era from the 4K captures, the App Store
screens) to .tmp/gameplay/trailers/maze-3d/out/, where tools/media.mjs stages them for R2.
"""

import subprocess
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / ".tmp"
MASTERS = TMP / "gameplay" / "maze-3d-masters"
SHOTS = TMP / "maze" / "store-shots"
RENDERS = TMP / "maze" / "3d" / "studio-4096"
CLIENT = TMP / "maze" / "3d-game"
IMG = ROOT / "src" / "3d" / "img"
MEDIA = TMP / "gameplay" / "trailers" / "maze-3d" / "out"

BOARD = (0.14, 0.04, 0.86, 0.985)

ERAS = [
    ("1917", "d1917-4k60.mp4", 13.2),
    ("1920s", "d1920s-4k60.mp4", 11.7),
    ("1930s", "d1930s-4k60.mp4", 4.4),
    ("1940s", "d1940s-4k60.mp4", 14.3),
    ("1950s", "d1950s-4k60.mp4", 5.5),
    ("1960s", "d1960s-4k60.mp4", 9.7),
    ("1970s", "d1970s-4k60.mp4", 9.6),
    ("1980s", "d1980s-4k60.mp4", 5.4),
    ("1990s", "d1990s-4k60.mp4", 17.8),
    ("2000s", "d2000s-4k60.mp4", 11.2),
    ("2010s", "d2010s-4k60.mp4", 21.6),
    ("2020s", "d2020s-4k60.mp4", 10.1),
    ("2030s", "d2030s-4k60.mp4", 6.9),
    ("orbit", "final-150-4k60.mp4", 33.5),
]
ERA_WIDTHS = (480, 720, 1080)

SCREENS = [
    ("frenzy-1957", "iphone-6.5/01-frenzy-1957.png"),
    ("orbital-finale", "iphone-6.5/02-orbital-finale.png"),
    ("golden-key", "iphone-6.5/03-golden-key.png"),
    ("autumn-1987", "iphone-6.5/04-autumn-1987.png"),
    ("neon-snow-2027", "iphone-6.5/05-neon-snow-2027.png"),
    ("opening-1917", "extras/opening-1917.png"),
    ("green-1947", "extras/green-1947.png"),
]
SCREEN_WIDTHS = (720, 1080, 1440)

RENDER_NAMES = ("coney-whole", "key", "portal", "portal-locked", "clock", "shovel", "spike", "cupcake", "burger", "burger-frenzy", "water")
RENDER_SIZES = (192, 384)


def frame(video: Path, seconds: float) -> Image.Image:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(seconds), "-i", str(video), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
        check=True, capture_output=True,
    ).stdout
    return Image.open(BytesIO(raw)).convert("RGB")


def punch(im: Image.Image, box) -> Image.Image:
    left, top, right, bottom = box
    return im.crop((round(left * im.width), round(top * im.height), round(right * im.width), round(bottom * im.height)))


def fit(im: Image.Image, ratio: float) -> Image.Image:
    want = im.width / ratio
    if im.height > want:
        top = round((im.height - want) / 2)
        return im.crop((0, top, im.width, top + round(want)))
    wide = round(im.height * ratio)
    left = round((im.width - wide) / 2)
    return im.crop((left, 0, left + wide, im.height))


def save(im: Image.Image, stem: str, width: int, into: Path = IMG, quality: int = 60) -> None:
    ratio = width / im.width
    out = im.resize((width, round(im.height * ratio)), Image.LANCZOS)
    out.save(into / f"{stem}-{width}.avif", quality=quality, speed=2)
    out.save(into / f"{stem}-{width}.webp", quality=quality + 18, method=6)


def eras() -> None:
    for era, name, at in ERAS:
        master = fit(punch(frame(MASTERS / name, at), BOARD), 4 / 3)
        for w in ERA_WIDTHS:
            save(master, f"era-{era}", w, MEDIA, quality=52)
        print(f"era-{era}: {master.width}x{master.height}")


def screens() -> None:
    for stem, rel in SCREENS:
        master = Image.open(SHOTS / rel).convert("RGB")
        for w in SCREEN_WIDTHS:
            save(master, f"screen-{stem}", w, MEDIA, quality=54)
        print(f"screen-{stem}: {master.width}x{master.height}")


def renders() -> None:
    for name in RENDER_NAMES:
        im = Image.open(RENDERS / f"{name}.png").convert("RGBA")
        box = im.getbbox()
        im = im.crop(box)
        side = max(im.width, im.height)
        pad = round(side * 0.06)
        canvas = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
        canvas.paste(im, (pad + (side - im.width) // 2, pad + (side - im.height) // 2), im)
        for s in RENDER_SIZES:
            save(canvas, f"render-{name}", s, quality=70)
        print(f"render-{name}: {canvas.width}")


def client() -> None:
    icon = Image.open(CLIENT / "app-icon-1024.png").convert("RGB")
    for s in (120, 240):
        icon.resize((s, s), Image.LANCZOS).save(IMG / f"app-icon-{s}.webp", quality=90, method=6)
        icon.resize((s, s), Image.LANCZOS).save(IMG / f"app-icon-{s}.png", optimize=True)
    card = Image.open(CLIENT / "og-3d.v2.png").convert("RGB")
    card.save(ROOT / "public" / "og-3d.v2.jpg", quality=90, subsampling=0, optimize=True)
    print("app icon, og-3d.v2.jpg")


def main() -> None:
    Image.MAX_IMAGE_PIXELS = None
    IMG.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    eras()
    screens()
    renders()
    client()


if __name__ == "__main__":
    main()
