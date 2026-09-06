// Each ticket answers the hand: it tilts toward the pointer or the finger and
// settles back when it leaves. Everything else (lift, sheen, parallax) is CSS
// driven from the --rx / --ry / --lift custom properties set here.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (n: number): number => Math.max(-1, Math.min(1, n));

for (const ticket of document.querySelectorAll<HTMLAnchorElement>(".ticket")) {
  let rx = 0;
  let ry = 0;
  let frame = 0;

  const paint = (): void => {
    frame = 0;
    ticket.style.setProperty("--rx", rx.toFixed(3));
    ticket.style.setProperty("--ry", ry.toFixed(3));
  };

  // Aim from the ticket's centre, which the tilt does not move, against the
  // untransformed size, so a tilted ticket does not feed back into itself.
  const aim = (event: PointerEvent): void => {
    const rect = ticket.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    rx = clamp((event.clientX - cx) / (ticket.offsetWidth / 2));
    ry = clamp((event.clientY - cy) / (ticket.offsetHeight / 2));
    if (!frame) frame = requestAnimationFrame(paint);
  };

  const rest = (): void => {
    rx = 0;
    ry = 0;
    delete ticket.dataset.active;
    if (frame) cancelAnimationFrame(frame);
    paint();
  };

  ticket.addEventListener("pointerenter", (event) => {
    if (reduceMotion.matches) return;
    ticket.dataset.active = "";
    aim(event);
  });
  ticket.addEventListener("pointermove", (event) => {
    if ("active" in ticket.dataset) aim(event);
  });
  ticket.addEventListener("pointerleave", rest);
  ticket.addEventListener("pointercancel", rest);
}

// ---------------------------------------------------------------------- chapters
// Each chapter's loop is poster-first: nothing is fetched until it is nearly on
// screen, only the one you are looking at plays, and "Watch the trailer" hands
// the same picture to a dialog. The loops are decoration, so a reduced-motion or
// metered visitor keeps the posters and the script leaves them alone.

// The trailers ship in three codecs; the browser takes the smallest it can decode.
const AV1 = 'video/mp4; codecs="av01.0.09M.08"';
const HEVC = 'video/mp4; codecs="hvc1.1.6.L123.90"';

const probe = document.createElement("video");
const decodes = (type: string): boolean => probe.canPlayType(type) === "probably";

const source = (data: DOMStringMap): string => {
  if (data.av1 && decodes(AV1)) return data.av1;
  if (data.hevc && decodes(HEVC)) return data.hevc;
  return data.h264 ?? "";
};

const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
const still = (): boolean => reduceMotion.matches || saveData;

// ---- the loops

const loops = [...document.querySelectorAll<HTMLVideoElement>(".loop")];
const held = new WeakSet<HTMLVideoElement>();
const onScreen = new Map<HTMLVideoElement, number>();
let showing = false;

const roll = (loop: HTMLVideoElement): void => {
  if (!loop.src) loop.src = source(loop.dataset);
  void loop.play().then(() => {
    (loop.parentElement as HTMLElement).dataset.playing = "";
  }).catch(() => {
    // Autoplay refused (a battery saver, say): the poster is the whole answer.
  });
};

const halt = (loop: HTMLVideoElement): void => {
  loop.pause();
  delete (loop.parentElement as HTMLElement).dataset.playing;
};

// One at a time: whichever loop shows most of itself, and only past half.
const cast = (): void => {
  let lead: HTMLVideoElement | null = null;
  let best = 0.5;
  if (!showing) {
    for (const [loop, ratio] of onScreen) {
      if (held.has(loop) || ratio < best) continue;
      lead = loop;
      best = ratio;
    }
  }
  for (const loop of loops) (loop === lead ? roll : halt)(loop);
};

if (loops.length && !still()) {
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        onScreen.set(entry.target as HTMLVideoElement, entry.intersectionRatio);
      }
      cast();
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] },
  );

  for (const loop of loops) {
    onScreen.set(loop, 0);
    watcher.observe(loop);

    const hold = loop.parentElement?.querySelector<HTMLButtonElement>(".hold");
    if (!hold) continue;
    hold.hidden = false;
    hold.addEventListener("click", () => {
      const pausing = !held.has(loop);
      pausing ? held.add(loop) : held.delete(loop);
      hold.textContent = pausing ? "Play" : "Pause";
      cast();
    });
  }
}

// ---- the dialog

const theatre = document.querySelector<HTMLDialogElement>(".theatre");
const film = theatre?.querySelector<HTMLVideoElement>(".film");
const marquee = theatre?.querySelector<HTMLElement>(".theatre-name");

type Transitions = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

// The loop and the trailer are the same picture, so morph one into the other.
const morph = (from: HTMLElement | null, to: HTMLElement | null, update: () => void): void => {
  const doc = document as Transitions;
  if (!doc.startViewTransition || !from || !to || reduceMotion.matches) {
    update();
    return;
  }
  from.style.viewTransitionName = "reel";
  const run = doc.startViewTransition(() => {
    from.style.viewTransitionName = "";
    to.style.viewTransitionName = "reel";
    update();
  });
  void run.finished.finally(() => {
    to.style.viewTransitionName = "";
  });
};

if (theatre && film && marquee) {
  let origin: HTMLElement | null = null;

  const shut = (): void => {
    morph(film, origin, () => {
      theatre.close();
      film.pause();
      film.removeAttribute("src");
      film.load();
      showing = false;
      cast();
      origin = null;
    });
  };

  for (const watch of document.querySelectorAll<HTMLButtonElement>(".watch")) {
    watch.addEventListener("click", () => {
      const data = watch.dataset;
      origin = watch.closest(".reel")?.querySelector<HTMLElement>(".body") ?? null;
      marquee.textContent = data.name ?? "";
      film.poster = data.poster ?? "";
      film.style.aspectRatio = data.ratio ?? "16 / 9";
      film.src = source(data);
      morph(origin, film, () => {
        showing = true;
        cast();
        theatre.showModal();
        void film.play().catch(() => {
          // Left paused with its controls: the poster is already the title card.
        });
      });
    });
  }

  theatre.addEventListener("submit", (event) => {
    event.preventDefault();
    shut();
  });

  theatre.addEventListener("cancel", (event) => {
    event.preventDefault();
    shut();
  });
}
