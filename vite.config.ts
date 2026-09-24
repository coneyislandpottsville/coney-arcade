import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// A page, a small stylesheet: inline it so the first paint needs no second request.
function inlineCss(): Plugin {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const used = new Set<string>();
      for (const page of Object.values(bundle)) {
        if (page.type !== "asset" || !page.fileName.endsWith(".html")) continue;
        let source = String(page.source);
        for (const [name, asset] of Object.entries(bundle)) {
          if (asset.type !== "asset" || !name.endsWith(".css")) continue;
          const link = new RegExp(`<link rel="stylesheet"[^>]*href="/${name}"[^>]*>`);
          if (!link.test(source)) continue;
          source = source.replace(link, `<style>${String(asset.source).trim()}</style>`);
          used.add(name);
        }
        page.source = source;
      }
      for (const name of used) delete bundle[name];
    },
  };
}

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [inlineCss()],
  build: {
    target: "es2022",
    modulePreload: false,
    rolldownOptions: {
      input: { main: page("index.html"), "3d": page("3d.html") },
    },
  },
  server: { host: true },
  preview: { host: true },
});
