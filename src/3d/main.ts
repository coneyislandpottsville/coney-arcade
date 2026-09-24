import "./style.css";
import { fillBoard } from "./board";
import { mazeField } from "./maze";
import { createMusic } from "./music";
import { createScenery, type Scenery, type SceneryStatus } from "./scenery";

const TINTS: Record<string, [number, number, number]> = {
  "1917": [0.94, 0.63, 0.23],
  "1920s": [0.91, 0.69, 0.29],
  "1930s": [0.84, 0.29, 0.61],
  "1940s": [0.48, 0.66, 0.63],
  "1950s": [1.0, 0.29, 0.18],
  "1960s": [0.69, 0.66, 0.47],
  "1970s": [0.95, 0.54, 0.16],
  "1980s": [0.85, 0.72, 0.63],
  "1990s": [1.0, 0.23, 0.23],
  "2000s": [0.5, 0.6, 0.77],
  "2010s": [0.94, 0.63, 0.23],
  "2020s": [0.91, 0.94, 1.0],
  "2030s": [1.0, 0.31, 0.25],
  orbit: [1.0, 0.31, 0.25],
};

const LENGTHS: Record<string, number> = {
  "1917": 20.12,
  "1920s": 15.7381,
  "1930s": 22.0632,
  "1940s": 17.4664,
  "1950s": 17.3464,
  "1960s": 23.8381,
  "1970s": 16.5348,
  "1980s": 15.7948,
  "1990s": 14.6548,
  "2000s": 14.9948,
  "2010s": 15.4864,
  "2020s": 15.4864,
  "2030s": 17.4548,
};

const root = document.documentElement;
const media = document.body.dataset.media ?? "/media/maze-3d/";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
const still = (): boolean => reduceMotion.matches || saveData;

const remembered = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const remember = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    return;
  }
};

// ---------------------------------------------------------------------- scenery
// The maze behind the page: drawn only when the visitor's device and preferences
// allow it, tinted by the era in view, and switchable from the bar.

const canvas = document.querySelector<HTMLCanvasElement>(".scenery");
const sceneryToggle = document.querySelector<HTMLButtonElement>('[data-toggle="scenery"]');
let scenery: Scenery | null = null;
let sceneryStatus: SceneryStatus = "still";
let sceneryWanted = !still() && remembered("maze3d-scenery") !== "off";

const paintSceneryToggle = (): void => {
  if (!sceneryToggle) return;
  const label = sceneryToggle.querySelector("span");
  const unavailable = sceneryStatus === "unavailable";
  const playing = sceneryWanted && (sceneryStatus === "animated" || sceneryStatus === "paused" || sceneryStatus === "loading");
  sceneryToggle.setAttribute("aria-pressed", String(playing));
  sceneryToggle.disabled = still() || unavailable || (sceneryWanted && sceneryStatus === "still" && scenery !== null);
  if (label) label.textContent = playing ? "Scenery on" : "Scenery still";
  sceneryToggle.title = still()
    ? "The scenery stays still to respect your motion and data preferences"
    : unavailable
      ? "Animated scenery is unavailable here"
      : playing
        ? "Pause the animated scenery"
        : "Animate the scenery";
};

const setSceneryStatus = (status: SceneryStatus): void => {
  sceneryStatus = status;
  root.dataset.scenery = status;
  paintSceneryToggle();
};

const startScenery = (): void => {
  if (!canvas || scenery) return;
  setSceneryStatus("loading");
  scenery = createScenery(canvas, mazeField(64, 32, 8, 20260923), setSceneryStatus);
  if (scenery) scenery.setTint(TINTS[currentEra] ?? TINTS["1917"]!);
};

const stopScenery = (): void => {
  scenery?.dispose();
  scenery = null;
  setSceneryStatus("still");
};

if (canvas && sceneryToggle) {
  sceneryToggle.hidden = false;
  if (sceneryWanted) window.setTimeout(startScenery, 350);
  else setSceneryStatus("still");
  sceneryToggle.addEventListener("click", () => {
    sceneryWanted = !sceneryWanted;
    remember("maze3d-scenery", sceneryWanted ? null : "off");
    if (sceneryWanted) startScenery();
    else stopScenery();
    paintSceneryToggle();
  });
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) {
      sceneryWanted = false;
      stopScenery();
    }
    paintSceneryToggle();
  });
}

// ---------------------------------------------------------------------- music
// One of the game's own loops, the era's bed, quietly under the page once asked for.

const music = createMusic(media, LENGTHS);
const musicToggle = document.querySelector<HTMLButtonElement>('[data-toggle="music"]');

const paintMusicToggle = (): void => {
  if (!musicToggle) return;
  const label = musicToggle.querySelector("span");
  musicToggle.setAttribute("aria-pressed", String(music.on));
  const text = music.playing ? "Music on" : music.on ? "Music ready" : "Music off";
  if (label) label.textContent = text;
  musicToggle.title = music.on ? "Stop the music" : "Play the era's loop, quietly, while you browse";
};

if (musicToggle && "AudioContext" in window) {
  musicToggle.hidden = false;
  musicToggle.addEventListener("click", () => music.toggle());
  music.start(paintMusicToggle);
  paintMusicToggle();
}

// ---------------------------------------------------------------------- eras
// Whichever era is nearest the middle of the screen sets the tint and the music.

let currentEra = "1917";
const eraCards = [...document.querySelectorAll<HTMLElement>(".era[data-era]")];
const ratios = new Map<Element, number>();

const toHex = (rgb: [number, number, number]): string =>
  `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

const setEra = (era: string): void => {
  if (era === currentEra) return;
  currentEra = era;
  root.dataset.era = era;
  root.style.setProperty("--tint", toHex(TINTS[era] ?? TINTS["1917"]!));
  for (const card of eraCards) {
    if (card.dataset.era === era) card.dataset.current = "";
    else delete card.dataset.current;
  }
  scenery?.setTint(TINTS[era] ?? TINTS["1917"]!);
  music.setEra(LENGTHS[era] ? era : "2030s");
};

const hero = document.querySelector<HTMLElement>(".hero");
if (hero) hero.dataset.era = "1917";

const eraWatch = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
    const middle = window.innerHeight / 2;
    let best: Element | null = null;
    let distance = Infinity;
    for (const [element, ratio] of ratios) {
      if (ratio < 0.5) continue;
      const rect = element.getBoundingClientRect();
      const away = Math.abs(rect.top + rect.height / 2 - middle);
      if (away < distance) {
        distance = away;
        best = element;
      }
    }
    if (best) setEra((best as HTMLElement).dataset.era ?? "1917");
  },
  { threshold: [0, 0.5, 1] },
);
for (const target of [hero, ...eraCards]) if (target) eraWatch.observe(target);

// ---------------------------------------------------------------------- the screen
// The frame answers the hand like the arcade's tickets, and the loop only rolls in view.

const AV1 = 'video/mp4; codecs="av01.0.09M.08"';
const HEVC = 'video/mp4; codecs="hvc1.1.6.L123.90"';
const probe = document.createElement("video");
const decodes = (type: string): boolean => probe.canPlayType(type) === "probably";
const source = (data: DOMStringMap): string => {
  if (data.av1 && decodes(AV1)) return data.av1;
  if (data.hevc && decodes(HEVC)) return data.hevc;
  return data.h264 ?? "";
};

const screen = document.querySelector<HTMLElement>(".screen");
const clamp = (n: number): number => Math.max(-1, Math.min(1, n));

if (screen && !reduceMotion.matches) {
  let rx = 0;
  let ry = 0;
  let frame = 0;
  const paint = (): void => {
    frame = 0;
    screen.style.setProperty("--rx", rx.toFixed(3));
    screen.style.setProperty("--ry", ry.toFixed(3));
  };
  const aim = (event: PointerEvent): void => {
    const rect = screen.getBoundingClientRect();
    rx = clamp((event.clientX - (rect.left + rect.width / 2)) / (screen.offsetWidth / 2));
    ry = clamp((event.clientY - (rect.top + rect.height / 2)) / (screen.offsetHeight / 2));
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const rest = (): void => {
    rx = 0;
    ry = 0;
    delete screen.dataset.active;
    screen.style.setProperty("--lift", "0");
    if (frame) cancelAnimationFrame(frame);
    paint();
  };
  screen.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    screen.dataset.active = "";
    screen.style.setProperty("--lift", "1");
    aim(event);
  });
  screen.addEventListener("pointermove", (event) => {
    if ("active" in screen.dataset) aim(event);
  });
  screen.addEventListener("pointerleave", rest);
  screen.addEventListener("pointercancel", rest);
}

const loop = document.querySelector<HTMLVideoElement>(".loop");
const bezel = loop?.parentElement as HTMLElement | null;
const hold = bezel?.querySelector<HTMLButtonElement>(".hold") ?? null;
let held = false;
let showing = false;
let loopVisible = false;

const roll = (): void => {
  if (!loop || !bezel) return;
  if (!loop.src) loop.src = source(loop.dataset);
  void loop
    .play()
    .then(() => {
      bezel.dataset.playing = "";
    })
    .catch(() => {});
};

const halt = (): void => {
  if (!loop || !bezel) return;
  loop.pause();
  delete bezel.dataset.playing;
};

const cast = (): void => {
  if (loopVisible && !held && !showing) roll();
  else halt();
};

if (loop && bezel && !still()) {
  new IntersectionObserver(
    (entries) => {
      for (const entry of entries) loopVisible = entry.intersectionRatio >= 0.4;
      cast();
    },
    { threshold: [0, 0.4, 1] },
  ).observe(loop);
  if (hold) {
    hold.hidden = false;
    hold.addEventListener("click", () => {
      held = !held;
      hold.textContent = held ? "Play" : "Pause";
      cast();
    });
  }
}

// ---------------------------------------------------------------------- the theatre

const theatre = document.querySelector<HTMLDialogElement>(".theatre");
const film = theatre?.querySelector<HTMLVideoElement>(".film");
const marquee = theatre?.querySelector<HTMLElement>(".theatre-name");

if (theatre && film && marquee) {
  const shut = (): void => {
    theatre.close();
    film.pause();
    film.removeAttribute("src");
    film.load();
    showing = false;
    cast();
  };

  for (const watch of document.querySelectorAll<HTMLButtonElement>(".watch")) {
    watch.addEventListener("click", () => {
      const data = watch.dataset;
      marquee.textContent = data.name ?? "";
      film.poster = data.poster ?? "";
      film.src = source(data);
      showing = true;
      cast();
      theatre.showModal();
      void film.play().catch(() => {});
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
  theatre.addEventListener("click", (event) => {
    if (event.target === theatre) shut();
  });
}

// ---------------------------------------------------------------------- the board

const board = document.querySelector<HTMLElement>(".board");
const fame = document.querySelector("#hall-of-fame");
if (board && fame) {
  const watcher = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watcher.disconnect();
      void fillBoard(board);
    },
    { rootMargin: "600px 0px" },
  );
  watcher.observe(fame);
}
