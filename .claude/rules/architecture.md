# Tech stack and architecture

No framework. The product is plain Node.js plus vanilla browser JS.

- Runtime: Node.js (CI pins node 20). CommonJS (`"type": "commonjs"`).
- Package manager: npm (`npm ci` in CI). Lockfile: `package-lock.json`.
- Backend: a single hand-rolled `http` server in `server.js` (~2900 lines). No Express.
  Routing is a chain of `url.pathname` checks and regex matches near the top of the file.
- Frontend: static HTML + vanilla JS (`app.js`, `dashboard.js`, `storefront.js`,
  `home.js`, `docs.js`). No bundler, no build step. Wallet/chain calls use ethers v6
  in the browser (`BrowserProvider`).
- Smart contracts: Solidity compiled in-process with `solc` (no Hardhat/Foundry).
  Deploy via a plain ethers v6 script.
- Storage: JSON files under `data/` (gitignored). No database yet. Production path is
  to swap the JSON files for Supabase/Postgres behind the same API shape.
- Dependencies: `ethers` ^6.16.0, `solc` ^0.8.30, `acorn` ^8.17.0.

## Directory map

CLAUDE.md and this rules directory live at the root of the git-tracked app repo,
`outputs/arc-invoice-usdc/`. Paths below are relative to that repo root unless prefixed
with `../`.

```
server.js                       HTTP server: routing, invoice/agent/x402 APIs, verify, webhooks, telegram
app.js                          Invoice dashboard + public /pay/:id flow + CCTP bridge logic
app.html / index.html           Launch app shell / homepage
dashboard.js + dashboard.html   Seller dashboard
storefront.js + storefront.html Creator storefront, served at /s/:slug
home.js / docs.js               Homepage and docs page logic
contracts/PaymentRouter.sol     Live settlement contract (transferFrom + InvoicePaid event)
contracts/PaymentRouter.abi.json
scripts/deploy-payment-router.js Compiles + deploys PaymentRouter, writes address to .env
data/*.json                     invoices, sellers, products, webhooks, webhook-logs, payment-attempts, api-keys, events (gitignored)
.env / .env.example             Server config and secrets
.github/workflows/deploy.yml    CI: syntax check + FTP deploy to cPanel

Outside this repo (siblings under the outer fundline/ working folder, not deployed):
../arc-allowance-dashboard/     Separate "VaultLens" allowance-monitor app (own server.js, port differs)
../../scratch/                  One-off maintenance scripts (audit_icons, sync_brand_fix, etc.)
../../work/                     Local static server + logs, scratch only
../../audit_report.md           Technical audit notes (written in Vietnamese)
../../run-fundline-server.bat   Start the main app on 127.0.0.1:5190 (fallback 5191)
../../run-deploy-payment-router.bat  Run the contract deploy script
../../run-arc-invoice-server.bat     Alternate launcher for the invoice app
../../run-vaultlens-server.bat       Launcher for the allowance dashboard
```

## Agent and x402 surface (all in `server.js`)

- Agent/SaaS API under `/api/agent/*` (invoices, webhooks, webhook-logs), API-key protected.
- x402 pay-per-call at `GET /api/x402/invoices/:id`: returns HTTP 402 with an `accepts`
  array when no `X-PAYMENT` header is present, verifies the supplied payment, then 200.
- Webhooks fire `invoice.paid` when an invoice reaches `paid`; optional HMAC signature
  via `X-Fundline-Signature`.
