#!/usr/bin/env node
// The desktop builds live in R2, never in git. `mirror` takes a release of the Unreal client from
// GitHub, copies its three files into the downloads bucket under v<version>/ and points 3d.html at
// them (links, file names, sizes, version).
//
//   node tools/downloads.mjs mirror [version]     the latest release when no version is given
//
// Needs gh (a token in GH_TOKEN or ~/.config/coney/github-token) and rclone with the r2 remote.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAGE = join(ROOT, "3d.html");
const STORE = join(ROOT, ".tmp", "downloads");
const REPO = "coneyislandpottsville/coney-island-food-game";
const REMOTE = "r2:coney-arcade-downloads";
const FILES = {
  setup: (v) => `ConeyIsland-Setup-${v}.exe`,
  win: (v) => `ConeyIsland-${v}-win64.zip`,
  mac: (v) => `ConeyIsland-${v}-mac.zip`,
};

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32", ...opts }).trim();

if (!process.env.GH_TOKEN) {
  const file = join(homedir(), ".config", "coney", "github-token");
  if (existsSync(file)) process.env.GH_TOKEN = readFileSync(file, "utf8").trim();
}

const command = process.argv[2];
if (command !== "mirror") {
  console.error("usage: node tools/downloads.mjs mirror [version]");
  process.exit(1);
}

const version = process.argv[3] ?? run("gh", ["release", "view", "--repo", REPO, "--json", "tagName", "--jq", ".tagName"]).replace(/^v/, "");
const tag = `v${version}`;
const dir = join(STORE, tag);
mkdirSync(dir, { recursive: true });

run("gh", ["release", "download", tag, "--repo", REPO, "--dir", dir, "--pattern", "ConeyIsland-*", "--clobber"]);
const sizes = {};
for (const [kind, name] of Object.entries(FILES)) {
  const path = join(dir, name(version));
  if (!existsSync(path)) {
    console.error(`[downloads] release ${tag} has no ${name(version)}`);
    process.exit(1);
  }
  sizes[kind] = statSync(path).size;
}

run("rclone", ["copy", dir, `${REMOTE}/${tag}`, "--s3-chunk-size", "100M", "--transfers", "3"], { stdio: "inherit" });

let html = readFileSync(PAGE, "utf8");
html = html.replace(/ConeyIsland-Setup-[\d.]+\.exe/g, FILES.setup(version));
html = html.replace(/ConeyIsland-[\d.]+-win64\.zip/g, FILES.win(version));
html = html.replace(/ConeyIsland-[\d.]+-mac\.zip/g, FILES.mac(version));
html = html.replace(/\/dl\/v[\d.]+\//g, `/dl/${tag}/`);
html = html.replace(/Version [\d.]+/g, `Version ${version}`);
html = html.replace(/"softwareVersion": "[\d.]+"/, `"softwareVersion": "${version}"`);
for (const [kind, bytes] of Object.entries(sizes)) {
  html = html.replace(new RegExp(`(data-size="${kind}"[^>]*>[^<]*?)\\d+ MB`, "g"), `$1${Math.round(bytes / 1e6)} MB`);
}
writeFileSync(PAGE, html);

const store = JSON.parse(run("curl", ["-sS", "https://itunes.apple.com/lookup?bundleId=com.coneyislandpottsville.ConeyMazeOfTime&country=us"]));
const ios = store.results?.[0]?.version;
console.log(`[downloads] ${tag} mirrored to ${REMOTE}/${tag}; 3d.html now links it (App Store is at ${ios ?? "unknown"})`);
