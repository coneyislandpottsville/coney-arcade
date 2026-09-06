<p><a href="https://arcade.coneyislandpottsville.com"><img src="public/og.jpg" alt="The Coney Island Pottsville Arcade share card: the masthead beside three stacked game tickets, Tiki Bar Slots on top, The Maze of Time and Trivia Bowl beneath"></a></p>

# The Coney Island Pottsville Arcade

The front door to the free games from The Coney Island, Pottsville, PA. One page, one ticket per game, each a link: The Maze of Time, Tiki Bar Slots and the Trivia Bowl. It is the arcade poster made tactile, and the tickets lift and tilt to follow the hand.

Play at [arcade.coneyislandpottsville.com](https://arcade.coneyislandpottsville.com).

## Run it

```sh
npm ci
npm run dev
```

`npm run build` writes the site to `dist/`. Vite, vanilla TypeScript, no runtime dependencies, fonts self-hosted with their OFL licences.

## Artwork

<img src="public/favicon.svg" width="72" alt="The arcade icon: a cream ticket carrying the Coney C">

The masters live outside the repo in `.tmp/`, never committed. `npm run images` cuts the ticket cards at six widths, and `npm run social` draws the C mark, the favicon set and the share card into `public/`.
