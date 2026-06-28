# Key on-chain facts (verbatim, do not alter)

- FundlineMemoRouter (Arc testnet, ACTIVE settlement router): `0x5613D701D2e6A70643680eabBeEdc0e924b30848`
  (verified on Arcscan; superset of PaymentRouter, adds opt-in payInvoiceWithMemo + InvoiceMemo
  log; same payInvoice selector and same InvoicePaid event/topic as V1). Set
  `ARC_PAYMENT_ROUTER_ADDRESS` to this.
- FundlineBatchRouter (Arc testnet, one-to-many payout for payroll): `0x8d838Cee79e3F8a500d9C1dDEf12DF2f33e84cc4`
  (verified on Arcscan; payBatch / payBatchWithMemo, non-custodial, atomic; env
  `ARC_BATCH_ROUTER_ADDRESS`, returned as `batchRouterAddress` in GET /api/config).
- FundlineRunEscrow (Arc testnet, non-custodial per-run workflow billing, VERIFIED on Arcscan): `0xefDDfF01090404f1eC942d96346B00638339b8D5`
  (deploy tx 0xecb2a6f2..., block 49154785; treasury beneficiary `0xee395f5bc60AE30b8279dfcf8cf0ABa392EC36FC`;
  verified via scripts/verify-run-escrow.js, compiler v0.8.35+commit.47b9dedd, optimizer 200, flattened;
  env `ARC_RUN_ESCROW_ADDRESS`, returned as `runEscrowAddress` in GET /api/config. fund/release/refund/
  claimRefund, self-emits InvoiceMemo. Treasury signs release/refund via `ARC_TREASURY_PRIVATE_KEY`.)
- PaymentRouter (Arc testnet, LEGACY, superseded by FundlineMemoRouter): `0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24`
- Deployer wallet: `0x8124ca3f0ca935e6beb69f2857e33d32fa3b54ea`
- USDC on Arc (system contract, 6 decimals): `0x3600000000000000000000000000000000000000`
- Arc chainId: `5042002`
- Arc RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- CCTP TokenMessengerV2: `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- CCTP MessageTransmitterV2: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- CCTP domains: Ethereum Sepolia 0, Base Sepolia 6, Arc 26
- Source-chain USDC: Ethereum Sepolia `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`,
  Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Local server / public base: `127.0.0.1:5190` / `https://fundline.xyz`
- Arcscan API base: `https://testnet.arcscan.app/api/v2`. The PaymentRouter source is
  currently unverified on arcscan (`is_verified` false); verifying it improves transparency.
- CCTP v2 finality threshold: Fast 500, Standard 1000 (measured API fee values Fast 1000,
  Standard 2000; use the API value when available). Fast-transfer is not implemented.
- FundlineEscrow: not deployed yet. Planned env `ARC_ESCROW_ADDRESS`, returned as
  `escrowAddress` in GET /api/config.

## Decimal nuance (read before any amount math)

On Arc, USDC is BOTH the gas token AND an ERC-20 with 6 decimals. Always handle
6-decimal math and never assume 18 decimals. Note that `.env.example` also carries
`ARC_NATIVE_USDC_DECIMALS=18`; the audit flags the 6 vs 18 question as an open risk
(see `../../audit_report.md` section 2). Treat decimal handling as a hazard area.

## Payment verification priority

Prefer the PaymentRouter `InvoicePaid` event (it carries the invoiceId). For a direct USDC
transfer, parse the ERC-20 `Transfer(from, to, value)` and match recipient and amount.
Always guard against double-confirm by the `(chainId, txHash)` pair.
