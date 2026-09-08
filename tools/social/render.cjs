// The social kit, all from the vector C mark in .tmp and og.html next to this file:
//   src/img/c-mark.svg        the mark, editor data stripped, tight square viewBox (the page's seal)
//   public/favicon.svg        a cream ticket carrying the mark
//   public/favicon.ico        the same at 16, 32 and 48 px
//   public/apple-touch-icon.png  180 px, full bleed for iOS to round
//   public/og.v<N>.jpg          1200x630, rendered at 2x and resampled down; bump OG_VERSION when the
//                             card changes, so every share refetches it instead of a cached render
//
//   node tools/social/render.cjs
const { chromium } = require("playwright");
const fs = require("fs");

const OG_VERSION = 3;
const OG_FILE = `og.v${OG_VERSION}.jpg`;
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const at = (...p) => path.join(ROOT, ...p);
const fileUrl = (p) => "file:///" + p.replace(/\\/g, "/");

const GROUND = "#1a110c";
const CREAM = "#f3e6c8";
const INK = "#2a1608";

// A ticket in a 1024 box: perforation at x=728 with a notch at each end.
const TICKET = (corner) =>
  corner
    ? "M200 0H640A88 88 0 0 0 816 0H824A200 200 0 0 1 1024 200V824A200 200 0 0 1 824 1024H816A88 88 0 0 0 640 1024H200A200 200 0 0 1 0 824V200A200 200 0 0 1 200 0Z"
    : "M0 0H640A88 88 0 0 0 816 0H1024V1024H816A88 88 0 0 0 640 1024H0Z";
const PERFORATION = `<path d="M728 124V900" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="14" stroke-linecap="round" stroke-dasharray="34 30"/>`;

function cleanMark() {
  let svg = fs.readFileSync(at(".tmp", "brand", "coney-mark-slots.svg"), "utf8");
  svg = svg.replace(/<\?xml[^>]*\?>|<!--[\s\S]*?-->/g, "");
  svg = svg.replace(/<sodipodi:namedview[\s\S]*?\/>/g, "");
  svg = svg.replace(/\s+(?:inkscape|sodipodi):[\w-]+="[^"]*"/g, "");
  svg = svg.replace(/\s+xmlns:(?:inkscape|sodipodi|svg)="[^"]*"/g, "");
  svg = svg.replace(/\s+id="(?!Gradient)[^"]*"/g, "");
  svg = svg.replace(/\s+(?:class|version|style|width|height)="[^"]*"/g, "");
  svg = svg.replace(/\s+/g, " ").replace(/> </g, "><").trim();
  return svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
}

// Place the mark's ink box (not its 1024 canvas) centred on (cx, cy) at the given height.
function placed(inner, box, cx, cy, height) {
  const s = height / box.height;
  const tx = cx - (box.x + box.width / 2) * s;
  const ty = cy - (box.y + box.height / 2) * s;
  return `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)})">${inner}</g>`;
}

const svgDoc = (viewBox, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;

// ICO container holding PNG-encoded images.
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size % 256, 0);
    e.writeUInt8(size % 256, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += buf.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

async function rasterize(page, svg, size, transparent) {
  await page.setViewportSize({ width: size, height: size });
  const src = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  await page.setContent(
    `<style>html,body{margin:0;background:${transparent ? "transparent" : GROUND}}img{display:block}</style><img src="${src}" width="${size}" height="${size}">`,
  );
  await page.waitForLoadState("networkidle");
  return page.screenshot({ type: "png", omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}

(async () => {
  const inner = cleanMark();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });

  // The mark's ink box, measured in the browser.
  await page.setContent(svgDoc("0 0 1024 1024", inner));
  const box = await page.evaluate(() => {
    const b = document.querySelector("svg > g").getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const side = Math.max(box.width, box.height) * 1.06;
  const vx = box.x + box.width / 2 - side / 2;
  const vy = box.y + box.height / 2 - side / 2;
  fs.writeFileSync(
    at("src", "img", "c-mark.svg"),
    svgDoc(`${vx.toFixed(1)} ${vy.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`, `<title>The Coney Island mark</title>${inner}`),
  );

  const ticket = (corner) =>
    `<path d="${TICKET(corner)}" fill="${CREAM}"/>${PERFORATION}${placed(inner, box, 366, 512, 700)}`;
  const favicon = svgDoc("0 0 1024 1024", ticket(true));
  const touch = svgDoc("0 0 1024 1024", `<rect width="1024" height="1024" fill="${GROUND}"/>${ticket(false)}`);
  fs.writeFileSync(at("public", "favicon.svg"), favicon);

  const sizes = [16, 32, 48];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, buf: await rasterize(page, favicon, size, true) });
  fs.writeFileSync(at("public", "favicon.ico"), ico(pngs));
  fs.writeFileSync(at("public", "apple-touch-icon.png"), await rasterize(page, touch, 180, false));

  // OG image: render at 2x, then resample to 1200x630 through a canvas.
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await og.goto(fileUrl(path.join(__dirname, "og.html")), { waitUntil: "networkidle" });
  await og.evaluate(() => document.fonts.ready);
  await og.waitForTimeout(200);
  const big = await og.screenshot({ type: "png" });
  const jpeg = await page.evaluate(
    async ([src, w, h]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.92);
    },
    ["data:image/png;base64," + big.toString("base64"), 1200, 630],
  );
  fs.writeFileSync(at("public", OG_FILE), Buffer.from(jpeg.split(",")[1], "base64"));

  await browser.close();
  for (const f of ["src/img/c-mark.svg", "public/favicon.svg", "public/favicon.ico", "public/apple-touch-icon.png", `public/${OG_FILE}`]) {
    console.log(f.padEnd(30), (fs.statSync(at(f)).size / 1024).toFixed(1) + " KB");
  }
})();
