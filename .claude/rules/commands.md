# Commands

Verified scripts live in `package.json` (the repo root, `outputs/arc-invoice-usdc/`).
There is no lint, typecheck, or test runner configured. Run npm/node commands from the
repo root (the `.bat` launchers in the outer `fundline/` folder cd here for you).

- Install: `npm ci` (or `npm install`)
- Dev / start server: `npm start` (runs `node server.js`, serves on PORT or 5190)
- Start via launcher (Windows): `../../run-fundline-server.bat`
- Build: none (no build step)
- Lint: none configured. TODO: confirm if one is wanted.
- Typecheck: none (plain JS, no TypeScript).
- Test: no framework. `test_*.js` files are standalone node scripts:
  `node test_cctp_fee.js`, `node test_stepper.js`, etc.
- Syntax check (what CI runs): `node --check app.js && node --check server.js`
- Contract compile + deploy: `npm run deploy:payment-router`
  (runs `node scripts/deploy-payment-router.js`; needs `ARC_DEPLOYER_PRIVATE_KEY`,
  compiles `contracts/PaymentRouter.sol` with solc, writes the address back to `.env`)
- Deploy contract via launcher (Windows): `../../run-deploy-payment-router.bat`
