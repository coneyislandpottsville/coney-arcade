"""Stage the trailer deliverables for local development.

    python tools/stage-media.py

Copies the loops, posters and trailers from .tmp/gameplay/trailers/<game>/out
into public/media/<game> so `npm run dev` serves them from /media/. The folder
is gitignored: on the live site these files come from the media host instead.
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TRAILERS = ROOT / ".tmp" / "gameplay" / "trailers"
OUT = ROOT / "public" / "media"

GAMES = ("maze", "slots", "trivia")
FILES = (
    "poster.avif", "poster.jpg",
    "poster-loop.avif", "poster-loop.jpg",
    "loop-8s.mp4", "loop-8s.av1.mp4",
    "trailer-1080p60.mp4", "trailer-1080p60.av1.mp4", "trailer-1080p60.hevc.mp4",
)


def main() -> None:
    total = 0
    for game in GAMES:
        dest = OUT / game
        dest.mkdir(parents=True, exist_ok=True)
        for name in FILES:
            src = TRAILERS / game / "out" / name
            shutil.copyfile(src, dest / name)
            total += src.stat().st_size
        print(f"{game}: {len(FILES)} files")
    print(f"{total / 1e6:.1f} MB staged in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
