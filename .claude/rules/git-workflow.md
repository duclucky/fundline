# Git and workflow notes

- This directory (`outputs/arc-invoice-usdc/`) is the git repo for the product (its own
  `.git`), remote `https://github.com/duclucky/fundline.git`, default branch `main`.
  CLAUDE.md and these rules live here so they are tracked and deployed with the app.
- The outer `fundline/` working folder is NOT its own git repo. Its parent `.git` is the
  Windows home folder (`C:/Users/TBC`) and tracks unrelated files. Always run git commands
  from this directory so you act on the right repo.
- CI/CD: pushing to `main` triggers `.github/workflows/deploy.yml`, which runs
  `npm ci`, `node --check app.js`, `node --check server.js`, then FTP-deploys to cPanel
  (excludes `.git`, `node_modules`, `.env`, `data/`, logs). A bad `node --check` blocks
  deploy, so keep both files syntactically valid before pushing.
- Commit style in the nested repo is short imperative subjects (e.g. "Add auto deploy
  workflow"). Match that. Only commit or push when asked.
