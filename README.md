# The Coney Island Pottsville Arcade

The splash page at [arcade.coneyislandpottsville.com](https://arcade.coneyislandpottsville.com): the 11x17 arcade poster made tactile. Three tickets, one per game, each a link.

```
npm ci
npm run dev      # dev server, also on the LAN
npm run build    # static site in dist/
npm run preview  # serve dist/
npm run check    # type-check src/
```

Vite, vanilla TypeScript, no runtime dependencies. Fonts are self-hosted under `public/fonts` with their OFL licences. Every push to `main` deploys to GitHub Pages through `.github/workflows/pages.yml`.

## Regenerating the art

The masters live outside the repo in `.tmp/` (the asset library, never committed).

```
npm run images   # card images at six widths, AVIF and WebP (Python 3 with Pillow)
npm run social   # C mark, favicons, touch icon and the OG image (Playwright Chromium)
```
