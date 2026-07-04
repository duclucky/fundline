"use strict";

// Fundline MCP server. Exposes Fundline workflows as MCP tools so any MCP client
// (Claude, Cursor, Hermes Agent, OpenClaw, ...) can discover and run them, paying
// per run from the operator's own Circle wallet on Arc.
//
// Non-custodial: the operator's Circle + Fundline keys live in THIS server's env;
// Fundline never sees them, and no one else can move the wallet's funds.
//
// Setup (in this folder):
//   npm i @modelcontextprotocol/sdk @circle-fin/developer-controlled-wallets
// Env:
//   FUNDLINE_BASE_URL   default http://127.0.0.1:5190
//   FUNDLINE_API_KEY    (required to run workflows)
//   CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID  (required to pay)
//   PAY_MODE            escrow (default) or x402
// Run (stdio MCP server): node examples/mcp-server/fundline-mcp.js
//
// Register it with an MCP client, e.g. Claude Desktop mcpServers config:
//   { "fundline": { "command": "node",
//       "args": ["/abs/path/examples/mcp-server/fundline-mcp.js"],
//       "env": { "FUNDLINE_API_KEY": "...", "CIRCLE_API_KEY": "...",
//                "CIRCLE_ENTITY_SECRET": "...", "CIRCLE_WALLET_ID": "..." } } }

const core = require("../fundline-agent-core");

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

const BASE = env("FUNDLINE_BASE_URL", "http://127.0.0.1:5190").replace(/\/$/, "");
const FUNDLINE_API_KEY = env("FUNDLINE_API_KEY", "");
const CIRCLE_API_KEY = env("CIRCLE_API_KEY", "");
const CIRCLE_ENTITY_SECRET = env("CIRCLE_ENTITY_SECRET", "");
const CIRCLE_WALLET_ID = env("CIRCLE_WALLET_ID", "");
const PAY_MODE = env("PAY_MODE", "escrow");

const TOOLS = [
  {
    name: "list_workflows",
    description: "Discover Fundline workflows and their per-run USDC price. Optional keyword search on slug or name.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Optional keyword to filter workflows (e.g. 'research', 'crypto')." } },
    },
  },
  {
    name: "run_workflow",
    description: "Pay for and run a Fundline workflow, returning its output. Pays from the operator's Circle wallet (escrow or x402).",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Workflow slug from list_workflows (e.g. 'client-research')." },
        tier: { type: "string", enum: ["normal", "plus", "pro"], description: "Quality/price tier. Default normal." },
        prompt: { type: "string", description: "The workflow input (what to run it on)." },
      },
      required: ["slug", "prompt"],
    },
  },
  {
    name: "wallet_info",
    description: "Show the agent's Circle wallet address and USDC balance on Arc.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function main() {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

  // Lazily initialize Circle only when payment credentials are present.
  let circle = null;
  let walletAddress = "";
  let usdc = "";
  async function ensurePaymentReady() {
    if (!FUNDLINE_API_KEY) throw new Error("FUNDLINE_API_KEY is not set on the MCP server.");
    if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !CIRCLE_WALLET_ID) {
      throw new Error("Circle wallet is not configured (CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID).");
    }
    if (!circle) {
      circle = await core.initCircle(CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET);
      walletAddress = await core.getWalletAddress(circle, CIRCLE_WALLET_ID);
      const cfg = await core.getConfig(BASE);
      usdc = cfg.usdcTokenAddress;
      if (!cfg.workflowBillingEnabled) throw new Error("Workflow billing is not enabled on this Fundline server.");
    }
  }

  const server = new Server({ name: "fundline", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};
    try {
      if (name === "list_workflows") {
        const list = await core.listWorkflows(BASE, args.query || "");
        const lines = list.map((w) => {
          const p = w.tiers && w.tiers.normal ? w.tiers.normal.usdc : "?";
          return `- ${w.slug} (${w.name}) from ${p} USDC`;
        });
        const header = args.query ? `Workflows matching "${args.query}" (${list.length}):` : `Workflows (${list.length}):`;
        return { content: [{ type: "text", text: header + "\n" + lines.join("\n") }] };
      }
      if (name === "wallet_info") {
        await ensurePaymentReady();
        const bal = await core.getUsdcBalance(circle, CIRCLE_WALLET_ID);
        return { content: [{ type: "text", text: `Circle wallet: ${walletAddress}\nUSDC balance: ${bal == null ? "unknown" : bal}` }] };
      }
      if (name === "run_workflow") {
        if (!args.slug || !args.prompt) throw new Error("slug and prompt are required.");
        await ensurePaymentReady();
        const result = await core.payAndRun({
          circle, walletId: CIRCLE_WALLET_ID, walletAddress, usdc,
          base: BASE, fundlineKey: FUNDLINE_API_KEY,
          slug: args.slug, tier: args.tier || "normal", prompt: args.prompt, payMode: PAY_MODE,
        });
        const head = `Ran ${args.slug} [${args.tier || "normal"}]. Paid ${result.priceUsdc || "?"} USDC; settlement tx ${result.releaseTx || "(none)"}${result.explorerUrl ? " (" + result.explorerUrl + ")" : ""}.`;
        return { content: [{ type: "text", text: head + "\n\n" + String(result.output || "") }] };
      }
      throw new Error("Unknown tool: " + name);
    } catch (e) {
      return { content: [{ type: "text", text: "Error: " + e.message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  process.stderr.write("Fundline MCP server running on stdio\n");
}

main().catch((e) => { process.stderr.write("Fundline MCP server error: " + e.message + "\n"); process.exit(1); });
