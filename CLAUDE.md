# Working in this repo

- GitHub account: **coneyislandpottsville**. Origin is `git@github.com-coney:coneyislandpottsville/coney-arcade.git`, the SSH alias from `~/.ssh/config`. Never switch it to https.
- Commit on `main` in clean, separate commits. Push nothing until asked. When asked: branch from `main` at HEAD, push it, `gh pr create --base main`. The user merges. Then `git fetch --prune`, `git merge --ff-only origin/main`, and delete the branch on both sides.
- Art masters live in `.tmp/` and are never committed. `npm run images` cuts the three tickets from `.tmp/poster/cards/<game>-card-4500.png`; `npm run social` draws the C mark, the favicons and `public/og.jpg`.
- Every push to `main` deploys to GitHub Pages at arcade.coneyislandpottsville.com.
