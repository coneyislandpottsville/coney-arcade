// The desktop builds, served from the downloads bucket at /dl/* on the site's own origin.
// Binding: DOWNLOADS (wrangler.jsonc).

const TYPES = {
  exe: "application/vnd.microsoft.portable-executable",
  zip: "application/zip",
  dmg: "application/x-apple-diskimage",
  json: "application/json",
};

const keyOf = (params) => decodeURIComponent(Array.isArray(params.path) ? params.path.join("/") : params.path);

function headers(key, obj) {
  const name = key.split("/").pop();
  const type = obj.httpMetadata?.contentType || TYPES[name.split(".").pop().toLowerCase()] || "application/octet-stream";
  return {
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    ETag: obj.httpEtag,
  };
}

// "bytes=a-b" | "bytes=a-" | "bytes=-n" -> R2 range | null | "unsatisfiable"
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) {
    const suffix = Math.min(Number(m[2]), size);
    return { offset: size - suffix, length: suffix };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return { offset: start, length: end - start + 1 };
}

export async function onRequestGet({ request, env, params }) {
  const key = keyOf(params);
  const head = await env.DOWNLOADS.head(key);
  if (!head) return new Response("No such build.", { status: 404 });

  if (request.headers.get("If-None-Match") === head.httpEtag) {
    return new Response(null, { status: 304, headers: headers(key, head) });
  }

  const size = head.size;
  const range = parseRange(request.headers.get("Range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const obj = await env.DOWNLOADS.get(key, range ? { range } : undefined);
  if (!obj) return new Response("No such build.", { status: 404 });

  const h = headers(key, obj);
  if (range) {
    h["Content-Range"] = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
    h["Content-Length"] = String(range.length);
    return new Response(obj.body, { status: 206, headers: h });
  }
  h["Content-Length"] = String(size);
  return new Response(obj.body, { status: 200, headers: h });
}

export async function onRequestHead({ env, params }) {
  const key = keyOf(params);
  const head = await env.DOWNLOADS.head(key);
  if (!head) return new Response(null, { status: 404 });
  const h = headers(key, head);
  h["Content-Length"] = String(head.size);
  return new Response(null, { status: 200, headers: h });
}
