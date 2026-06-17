# Key on-chain facts (verbatim, do not alter)

- PaymentRouter (Arc testnet): `0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24`
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

## Decimal nuance (read before any amount math)

On Arc, USDC is BOTH the gas token AND an ERC-20 with 6 decimals. Always handle
6-decimal math and never assume 18 decimals. Note that `.env.example` also carries
`ARC_NATIVE_USDC_DECIMALS=18`; the audit flags the 6 vs 18 question as an open risk
(see `../../audit_report.md` section 2). Treat decimal handling as a hazard area.
