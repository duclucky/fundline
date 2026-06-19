# Cross-chain payment roadmap (Fundline)

Status: living plan. Authored 2026-06-20 from a verified research workflow
(checked against Circle's circlefin/evm-cctp-contracts V2 source). Lives under
`.claude/` so it is FTP-excluded (not served on the site).

## Goal
Cut payer signatures for cross-chain USDC invoice payment (today ~4-5: approve +
depositForBurn on source, switch network, receiveMessage mint + payInvoice on Arc),
and handle a payer whose USDC is spread across multiple chains.

## Verified facts (CCTP V2)
- `MessageTransmitterV2.receiveMessage` is PERMISSIONLESS and the mint recipient +
  amount are decoded from the SIGNED burn body, not from the submitter. So anyone
  (a relayer, the payer, a third party) can submit it but CANNOT redirect or steal -
  worst case is liveness (stall), never custody. Fee is bounded by the payer-signed maxFee.
- Non-custodial HOLDS in every design considered.
- `depositForBurnWithHook` does NOT auto-execute hooks (execution is left to the
  integrator); it buys nothing for cutting signatures here. Do not rely on it.
- True ONE-signature 3-chain aggregation is IMPOSSIBLE for a plain EOA: EIP-712 binds
  each USDC authorization to one (chainId, token). The floor is N+1 (one burn per
  source + one final payInvoice). Circle Gateway BurnIntentSet packs N intents in one
  popup but forces a pre-deposit + ~15-19 min finality, worse for one-off payers.

## Decisions
- PAYER SELF-RELAYS the destination mint (payer signs receiveMessage + pays the tiny
  Arc gas, ~0.0036 USDC). Fundline pays $0 gas. NO relayer service, no hot wallet, no
  gas float, no relayer audit. (This is essentially the current CCTP behavior.)
- DEFER: a Fundline relayer; Circle Gateway (un-park only for repeat/pre-funded payers,
  and only after confirming Arc is a live Gateway destination); true 1-sig aggregation
  (impossible for EOA); intent solvers (Across/LiFi/Socket - no Arc + need a bundler);
  Circle App Kit / unified-balance-kit (built on Gateway + needs a bundler).

## Min payer signatures (payer-self-relay)
- Same-chain (USDC already on Arc): ~1 (payInvoice).
- Single non-Arc source: burn (1, or 1 permit + 1 burn) + receiveMessage (1) + payInvoice (1).
  The suggest-best-chain scan routes most payers to Arc, making ~1 the common case.
- 3-chain aggregation: N+1 (~4). Rare; build last, minimize sources (greedy, usually 2).

## Build order
1. CHAINS table refactor - collapse scattered CCTP constants into one per-chain table
   {key,name,chainId,chainIdHex,domain,usdc,tokenMessenger,messageTransmitter,rpcUrls,preference}.
   Makes the testnet->mainnet cutover a one-table edit. PENDING.
2. Scan balances + suggest-best-chain (client, pure read, no gas/sig). DONE 2026-06-20
   (commit 958ffbc): scanUsdcAcrossChains + suggestBestChainKey + autoPickBestSource in
   app.js; auto-picks the cheapest single chain that covers, manual dropdown override
   preserved, per-chain summary shown. Highest value, lowest risk.
3. Relayer-submitted mint - DROPPED per the payer-self-relay decision (Fundline pays $0).
4. Permit / ERC-3009 on the burn leg - drop the source-chain approve signature. Gated on
   confirming each source USDC implements it (native Circle USDC does; bridged may not). PENDING.
5. Greedy multi-source aggregation (only when no single chain covers) - LAST, rare, riskiest;
   needs per-source idempotency + a "funds are on Arc, finish paying" recovery state.

## Open questions
- Does each source-chain USDC implement EIP-2612 permit / ERC-3009? Confirm per source before step 4.
- Re-verify all CCTP V2 addresses, Arc domain 26, and Fast availability against Circle's MAINNET
  contract list before any mainnet cutover (Arc mainnet not live yet, expected 2026).
