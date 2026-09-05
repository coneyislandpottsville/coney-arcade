import { defineConfig, type Plugin } from "vite";

// One page, one small stylesheet: inline it so the first paint needs no second request.
function inlineCss(): Plugin {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") return;
      let source = String(html.source);
      for (const [name, asset] of Object.entries(bundle)) {
        if (asset.type !== "asset" || !name.endsWith(".css")) continue;
        const link = new RegExp(`<link rel="stylesheet"[^>]*href="/${name}"[^>]*>`);
        if (!link.test(source)) continue;
        source = source.replace(link, `<style>${String(asset.source).trim()}</style>`);
        delete bundle[name];
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  plugins: [inlineCss()],
  build: {
    target: "es2022",
    modulePreload: false,
  },
  server: { host: true },
  preview: { host: true },
});
