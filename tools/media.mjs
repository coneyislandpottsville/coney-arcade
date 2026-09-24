#!/usr/bin/env node
// The trailers live in R2, never in git. `stage` cuts them from the art library
// into public/media under a content version, `push` uploads that version and
// `pull` fetches it back on a clean checkout (what CI runs before the build).
//
//   node tools/media.mjs stage | push | pull
//
// The version is a hash of every file, so re-cutting a trailer moves the whole
// set to a new path and the immutable cache never has to be invalidated.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TRAILERS = join(ROOT, ".tmp", "gameplay", "trailers");
const MEDIA = join(ROOT, "public", "media");
const MANIFEST = join(ROOT, "tools", "media-manifest.json");
const PAGES = ["index.html", "3d.html"].map((name) => join(ROOT, name));
const BUCKET = "coney-arcade-media";
const WRANGLER = "wrangler@4.127.0";
const CACHE = "public,max-age=31536000,immutable";

const GAMES = ["maze", "slots", "trivia", "sharp-mountain", "maze-3d"];
const FILES = [
  "poster.avif", "poster.jpg",
  "poster-loop.avif", "poster-loop.jpg",
  "loop-8s.mp4", "loop-8s.av1.mp4",
  "trailer-1080p60.mp4", "trailer-1080p60.av1.mp4", "trailer-1080p60.hevc.mp4",
];
const ERAS = ["1917", "1920s", "1930s", "1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s", "2030s"];
const SCREENS = ["frenzy-1957", "orbital-finale", "golden-key", "autumn-1987", "neon-snow-2027", "opening-1917", "green-1947"];
const stills = (stems, widths) => stems.flatMap((stem) => widths.flatMap((w) => [`${stem}-${w}.avif`, `${stem}-${w}.webp`]));
const EXTRA = {
  "maze-3d": [
    "poster-loop-960.avif", "poster-loop-960.jpg", "poster-loop-1440.avif", "poster-loop-1440.jpg",
    ...ERAS.map((era) => `music-${era}.mp3`),
    ...stills([...ERAS, "orbit"].map((era) => `era-${era}`), [480, 720, 1080]),
    ...stills(SCREENS.map((name) => `screen-${name}`), [720, 1080, 1440]),
  ],
};
const filesFor = (game) => [...FILES, ...(EXTRA[game] ?? [])];

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function wrangler(argv) {
  const windows = process.platform === "win32";
  const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const args = ["--yes", WRANGLER, ...argv].map((a) => (windows ? quote(a) : a));
  const r = spawnSync(windows ? "npx.cmd" : "npx", args, { cwd: ROOT, stdio: "inherit", shell: windows });
  if (r.error) throw r.error;
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function readManifest() {
  if (!existsSync(MANIFEST)) {
    console.error("[media] no manifest; run `node tools/media.mjs stage` first");
    process.exit(1);
  }
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function needsToken() {
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) return;
  console.error("[media] CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
  process.exit(1);
}

const command = process.argv[2];

if (command === "stage") {
  const sources = [];
  for (const game of GAMES) {
    for (const name of filesFor(game)) {
      const source = join(TRAILERS, game, "out", name);
      if (!existsSync(source)) {
        console.error(`[media] missing ${source}`);
        process.exit(1);
      }
      sources.push({ key: posix.join(game, name), source });
    }
  }

  const digest = createHash("sha256");
  for (const { key, source } of sources) digest.update(`${key}:${sha(source)}\n`);
  const version = digest.digest("hex").slice(0, 8);

  // One version at a time on disk, so a stale cut cannot ship.
  if (existsSync(MEDIA)) rmSync(MEDIA, { recursive: true });
  const files = [];
  for (const { key, source } of sources) {
    const file = posix.join(version, key);
    const target = join(MEDIA, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    files.push(file);
  }

  writeFileSync(MANIFEST, `${JSON.stringify({ bucket: BUCKET, version, files }, null, 2)}\n`);

  const prefix = new RegExp(`/media/(?:[0-9a-f]{8}/)?(?=(?:${GAMES.join("|")})/)`, "g");
  for (const page of PAGES) {
    writeFileSync(page, readFileSync(page, "utf8").replace(prefix, `/media/${version}/`));
  }

  const bytes = sources.reduce((n, { source }) => n + statSync(source).size, 0);
  console.log(`[media] version ${version}: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
  console.log(`[media] the pages now point at /media/${version}/`);
} else if (command === "push") {
  needsToken();
  const { files } = readManifest();
  for (const file of files) {
    const source = join(MEDIA, file);
    if (!existsSync(source)) {
      console.error(`[media] missing ${source}; run stage first`);
      process.exit(1);
    }
    wrangler(["r2", "object", "put", `${BUCKET}/${file}`, "--file", source, "--cache-control", CACHE, "--remote"]);
  }
  console.log(`[media] pushed ${files.length} files to ${BUCKET}`);
} else if (command === "pull") {
  needsToken();
  const { files } = readManifest();
  let fetched = 0;
  for (const file of files) {
    const target = join(MEDIA, file);
    if (existsSync(target) && statSync(target).size > 0) continue;
    mkdirSync(dirname(target), { recursive: true });
    wrangler(["r2", "object", "get", `${BUCKET}/${file}`, "--file", target, "--remote"]);
    fetched += 1;
  }
  console.log(`[media] ${files.length} files present in public/media (${fetched} fetched)`);
} else {
  console.error("usage: node tools/media.mjs stage|push|pull");
  process.exit(1);
}
