# Working in this repo

- GitHub account: **coneyislandpottsville**. Origin is `git@github.com-coney:coneyislandpottsville/coney-arcade.git`, the SSH alias from `~/.ssh/config`. Never switch it to https.
- Art masters live in `.tmp/` and are never committed. `npm run images` cuts the tickets from `.tmp/poster/cards/<game>-card-4500.png`; `npm run social` draws the C mark, the favicons and the share card `public/og.v<N>.jpg`; bump the version when the card changes so shares refetch it.
