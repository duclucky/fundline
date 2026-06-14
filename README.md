# Fundline USDC

Non-custodial USDC invoice app for freelancers, indie developers, and service providers on Arc Testnet.

## Current demo

- Create invoices with client name, email, due date, note, and multiple line items.
- Require merchant wallet connection before creating invoices.
- Fill the USDC receiving wallet from the connected merchant wallet.
- Auto-calculate invoice total in USDC.
- Generate a public payment link at `/pay/:invoiceId`.
- Store invoices on the local Fundline server at `data/invoices.json` so payment links can be opened outside the creator browser.
- Show a QR code for the payment link.
- Track invoice states: `open`, `verifying`, `paid`, and `expired`.
- Verify payment on Arcscan before marking an invoice as `paid`.
- Let payers provide the wallet address that sent payment when they do not connect a wallet.
- Send a Telegram alert after an invoice is marked paid.
- Build and start a CCTP testnet transfer for moving native USDC from Ethereum Sepolia or Base Sepolia to Arc Testnet.
- Track `open`, `paid`, and `overdue` invoices.
- Download a simple PDF receipt after payment.
- Export invoices as CSV.
- Store demo data in browser `localStorage`.
- Keep `localStorage` as an offline cache only.

## Run

Open:

```text
run-fundline-server.bat
```

Then visit:

```text
http://127.0.0.1:5190
```

Routes:

```text
/       Homepage with Docs and Launch App choices
/app    Fundline dashboard
/docs   Product documentation
```

Payment links use the same local app:

```text
http://127.0.0.1:5190/pay/:invoiceId
```

## Telegram alerts

Fundline reads Telegram config from its own `.env` file. Copy `.env.example` to `.env` inside `outputs/arc-invoice-usdc` and put the bot token in `TELEGRAM_BOT_TOKEN`.

After changing Telegram config:

1. Restart `run-fundline-server.bat`.
2. In Settings, add the Telegram chat ID and enable payment alerts.

The bot token stays on the local server. The browser only sends invoice details and the chat ID to `/api/telegram/payment-paid`.

## Payment verification

The payment page does not let the payer mark an invoice paid manually. It asks Arcscan for a matching payment before updating status.

The current verifier accepts a payment when it finds:

- USDC token transfer from payer wallet to invoice receiving wallet.
- Exact amount equal to the invoice total.
- PaymentRouter `InvoicePaid` reference for the invoice when the router is configured.
- Transaction time after the invoice was created, with a small clock-skew tolerance.

If the payer does not connect a wallet in the app, they must enter the wallet address that sent the payment. A transaction hash is optional and only speeds up lookup.

When verification starts, the invoice briefly moves to `verifying`. If Arcscan does not return a valid match, the invoice returns to `open`. If the due date has passed and no payment is verified, the UI shows `expired`.

Paid invoices store payer wallet, transaction hash, verification source, and verification time. Fundline also stores every payment verification attempt as `pending`, `verified`, or `failed`, and rejects a transaction hash that has already verified another invoice. Those fields are included in CSV export, Telegram alerts, and PDF receipts.

## Cross-chain payment pilot

The public payment page prepares the next product direction: native USDC settlement across chains, without wrapped bridge tokens. Payers choose where their USDC is when paying an invoice. Arc USDC pays directly; supported source testnets can bridge first and then pay.

Current testnet scope:

```text
Source chain 1: Ethereum Sepolia
USDC:          0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
CCTP domain:   0

Source chain 2: Base Sepolia
USDC:          0x036CbD53842c5426634e7929541eC2318f3dCF7e
CCTP domain:   6

Destination:   Arc Testnet
USDC:          0x3600000000000000000000000000000000000000
CCTP domain:   26

TokenMessengerV2:     0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
MessageTransmitterV2: 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
```

The current app checks payer USDC balance on the selected chain. If Arc has enough USDC, it pays directly. If Base Sepolia or Ethereum Sepolia has enough USDC, it starts a bridge-and-pay flow: approve TokenMessengerV2, burn source USDC, fetch Circle attestation, mint on Arc, then pay the invoice.

The next production step is hardening the bridge worker and adding hosted logs/retries so users do not need to keep the browser open during the full CCTP flow.

Circle Wallets should be added after this pilot so non-crypto users can create or access an embedded wallet before paying or receiving invoices.

## Server invoice storage

Phase 2 adds server-backed invoice storage:

```text
GET    /api/invoices?merchantWallet=:wallet
POST   /api/invoices
GET    /api/invoices/:id
PATCH  /api/invoices/:id
```

The local server stores invoices in:

```text
outputs/arc-invoice-usdc/data/invoices.json
```

This makes `/pay/:id` work from another browser as long as it can reach the same Fundline server. For production, replace this JSON file with Supabase/Postgres using the same API shape.

## Agent and SaaS API

Phase 4 adds API-key protected endpoints for agents, SaaS tools, or backend automations that need to create invoices and receive payment events.

Set this in `outputs/arc-invoice-usdc/.env`:

```text
FUNDLINE_API_KEY=replace_with_a_long_random_agent_api_key
```

Send the key with either header:

```text
Authorization: Bearer $FUNDLINE_API_KEY
```

or:

```text
x-api-key: $FUNDLINE_API_KEY
```

Available endpoints:

```text
GET    /api/agent/invoices?merchantWallet=:wallet&status=open&limit=100
POST   /api/agent/invoices
GET    /api/agent/invoices/:id
GET    /api/agent/webhooks?merchantWallet=:wallet
POST   /api/agent/webhooks
GET    /api/agent/webhooks/:id
PATCH  /api/agent/webhooks/:id
DELETE /api/agent/webhooks/:id
GET    /api/agent/webhook-logs?merchantWallet=:wallet&invoiceId=:id&webhookId=:id&ok=false
GET    /api/agent/webhook-logs/:id
```

Use `Idempotency-Key` on `POST /api/agent/invoices` when an agent may retry the same request. Fundline returns the existing invoice for the same merchant wallet and key instead of creating a duplicate.

Create an invoice:

```bash
curl -X POST http://127.0.0.1:5190/api/agent/invoices \
  -H "Authorization: Bearer $FUNDLINE_API_KEY" \
  -H "Idempotency-Key: client-ltd-2026-06-retainer" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantWallet": "0x8124ca3f0ca935e6beb69f2857e33d32fa3b54ea",
    "merchantName": "Fundline Studio",
    "clientName": "Client Ltd",
    "clientEmail": "billing@client.com",
    "dueDate": "2026-06-30",
    "note": "AI automation consulting",
    "items": [
      { "description": "Consulting package", "quantity": 1, "unitPrice": 250 }
    ],
    "telegramChatId": "123456789",
    "telegramEnabled": true
  }'
```

The response includes `paymentLink`, so an agent can send the invoice URL directly to a customer.

Register a webhook:

```bash
curl -X POST http://127.0.0.1:5190/api/agent/webhooks \
  -H "Authorization: Bearer $FUNDLINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "merchantWallet": "0x8124ca3f0ca935e6beb69f2857e33d32fa3b54ea",
    "url": "https://example.com/webhooks/fundline",
    "event": "invoice.paid",
    "secret": "optional_shared_secret"
  }'
```

When an invoice moves from `open` or `verifying` to `paid`, Fundline sends:

```json
{
  "event": "invoice.paid",
  "sentAt": "2026-06-11T00:00:00.000Z",
  "invoice": {
    "id": "37f1cdd4727c0d85d32b",
    "number": "INV-2026-0001",
    "status": "paid",
    "total": 250,
    "merchantWallet": "0x...",
    "payerWallet": "0x...",
    "txHash": "0x...",
    "paymentLink": "http://127.0.0.1:5190/pay/37f1cdd4727c0d85d32b"
  }
}
```

If a webhook has `secret`, the request includes:

```text
X-Fundline-Signature: sha256=<hmac_sha256_body_signature>
```

Webhook delivery logs are stored locally in `outputs/arc-invoice-usdc/data/webhook-logs.json`.
Read them through the Agent API:

```bash
curl "http://127.0.0.1:5190/api/agent/webhook-logs?merchantWallet=0x8124ca3f0ca935e6beb69f2857e33d32fa3b54ea&limit=20" \
  -H "Authorization: Bearer $FUNDLINE_API_KEY"
```

Each log contains delivery ID, webhook ID, invoice ID, URL, success state, HTTP status, error preview and duration. Webhook secrets are never returned in log responses.

## Onchain wallet payment

Phase 5 adds a real wallet payment path on the public `/pay/:id` page.

If `ARC_PAYMENT_ROUTER_ADDRESS` is configured, the payer can:

1. Connect and sign in with an EVM wallet.
2. Approve the exact USDC amount for `PaymentRouter`.
3. Call `PaymentRouter.payInvoice(bytes32 invoiceId, address merchant, uint256 amount)`.
4. Let the app verify the resulting transaction on Arcscan.
5. Trigger the existing Telegram alert and `invoice.paid` webhook after verification.

Required server config:

```text
ARC_CHAIN_ID=5042002
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_NETWORK_NAME=Arc Testnet
ARC_USDC_TOKEN_ADDRESS=0x3600000000000000000000000000000000000000
ARC_USDC_DECIMALS=6
ARC_NATIVE_USDC_DECIMALS=18
ARC_PAYMENT_ROUTER_ADDRESS=0x_your_deployed_payment_router
```

To deploy `PaymentRouter`, put a funded Arc Testnet private key in `.env`:

```text
ARC_DEPLOYER_PRIVATE_KEY=0x_your_testnet_private_key
```

Then open:

```text
run-deploy-payment-router.bat
```

The deploy script compiles `PaymentRouter.sol`, deploys it with `ARC_USDC_TOKEN_ADDRESS`, and writes the deployed address back to `ARC_PAYMENT_ROUTER_ADDRESS` in `.env`.

If `ARC_PAYMENT_ROUTER_ADDRESS` is empty, the payment page keeps the onchain button disabled and still supports the safer manual flow: payer sends USDC, then verifies the transaction through Arcscan.

The router contract is:

```text
outputs/arc-invoice-usdc/contracts/PaymentRouter.sol
```

ABI for deploy tools or block explorer verification is in `outputs/arc-invoice-usdc/contracts/PaymentRouter.abi.json`.

It is non-custodial. It calls USDC `transferFrom(payer, merchant, amount)` and emits `InvoicePaid`; it does not hold customer funds.

## Production path

1. Replace `data/invoices.json` with Supabase/Postgres tables for merchants, invoices, and payments.
2. Move `FUNDLINE_API_KEY` and webhook secrets to a server-side secret manager.
3. Deploy `contracts/PaymentRouter.sol` with Arc Testnet USDC.
4. On `/pay/:id`, connect payer wallet.
5. Ask payer to approve exact USDC amount.
6. Call `PaymentRouter.payInvoice(bytes32 invoiceId, address merchant, uint256 amount)`. `amount` is USDC base units, so `10.50 USDC` is `10500000`.
7. Listen for `InvoicePaid(invoiceId, payer, merchant, amount, usdc)`.
8. Update invoice status to `paid` and dispatch the `invoice.paid` webhook.

The contract never holds funds. It transfers USDC directly from payer to merchant and emits a payment event for invoice matching.
