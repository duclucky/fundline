"use strict";

// Demo: an AI agent that pays for Fundline workflow runs using its OWN Circle
// Developer-Controlled Wallet on Arc. Non-custodial: the Circle API key + entity
// secret belong to you and stay in your environment; Fundline never sees them.
// Standalone example, NOT part of the Fundline app. Shares logic with the MCP
// server via fundline-agent-core.js.
//
// Two phases:
//   node examples/circle-agent-demo.js setup   ONE-TIME: create the agent wallet,
//                                              print its address + how to fund it.
//   node examples/circle-agent-demo.js run     AUTONOMOUS: discover the workflow
//                                              menu, choose, then pay -> run.
//
// Prerequisites (one time, human): Circle testnet API key, a registered entity
// secret, the SDK (npm i @circle-fin/developer-controlled-wallets), a Fundline API
// key. See examples/README.md.
//
// Env (run phase): CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_ID,
// FUNDLINE_API_KEY, FUNDLINE_BASE_URL, PAY_MODE (escrow|x402), WORKFLOW_QUERY
// (optional search); choose work via WORKFLOW_SLUG/WORKFLOW_TIER/WORKFLOW_PROMPT
// or WORKFLOW_TASKS (JSON array of {slug,tier,prompt}).

const core = require("./fundline-agent-core");
const ARC_FAUCET_URL = "https://faucet.circle.com";

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error("Missing env " + name); process.exit(1); }
  return v;
}

// ONE-TIME setup: create the agent's Circle wallet on Arc and print how to fund it.
async function cmdSetup() {
  const circle = await core.initCircle(requireEnv("CIRCLE_API_KEY"), requireEnv("CIRCLE_ENTITY_SECRET"));
  console.log("Creating a Circle wallet on ARC-TESTNET for your agent...\n");
  const set = await circle.createWalletSet({ name: "Fundline agent" });
  const wallets = await circle.createWallets({ blockchains: ["ARC-TESTNET"], count: 1, walletSetId: set.data.walletSet.id });
  const w = wallets.data.wallets[0];
  console.log("Wallet created:");
  console.log("  CIRCLE_WALLET_ID = " + w.id);
  console.log("  address          = " + w.address);
  console.log("\nNext (one time):");
  console.log("  1. Fund the address with USDC from the Arc testnet faucet: " + ARC_FAUCET_URL + " (10 USDC/hour)");
  console.log("  2. export CIRCLE_WALLET_ID=" + w.id);
  console.log("  3. node examples/circle-agent-demo.js run");
  console.log("\nAfter that the agent runs autonomously; no more manual steps per run.");
}

// AUTONOMOUS: discover the menu, choose, pay, run.
async function cmdRun() {
  const circle = await core.initCircle(requireEnv("CIRCLE_API_KEY"), requireEnv("CIRCLE_ENTITY_SECRET"));
  const walletId = env("CIRCLE_WALLET_ID", "");
  if (!walletId) { console.error("No CIRCLE_WALLET_ID. Run `setup` first, fund the wallet, then set it."); process.exit(1); }
  const fundlineKey = requireEnv("FUNDLINE_API_KEY");
  const base = env("FUNDLINE_BASE_URL", "http://127.0.0.1:5190").replace(/\/$/, "");
  const payMode = env("PAY_MODE", "escrow");

  const walletAddress = await core.getWalletAddress(circle, walletId);
  console.log("Agent Circle wallet: " + walletAddress + " (" + walletId + ")");
  const bal = await core.getUsdcBalance(circle, walletId);
  if (bal != null) console.log("USDC balance: " + bal);

  const cfg = await core.getConfig(base);
  if (!cfg.workflowBillingEnabled) { console.error("Workflow billing is not enabled on this Fundline server."); process.exit(1); }
  const usdc = cfg.usdcTokenAddress;

  // Discover (optionally search) the menu, so the agent chooses from real options.
  const queryStr = env("WORKFLOW_QUERY", "");
  const catalog = await core.listWorkflows(base, queryStr);
  const bySlug = {};
  catalog.forEach((w) => { bySlug[w.slug] = w; });
  console.log("\nAvailable workflows" + (queryStr ? ` matching "${queryStr}"` : "") + " (" + catalog.length + "):");
  catalog.slice(0, 30).forEach((w) => {
    const p = w.tiers && w.tiers.normal ? w.tiers.normal.usdc : "?";
    console.log("  - " + w.slug + "  (" + w.name + ")  from " + p + " USDC");
  });

  // Choose what to run: WORKFLOW_TASKS (several) or a single WORKFLOW_SLUG task.
  let tasks;
  try {
    tasks = JSON.parse(env("WORKFLOW_TASKS", ""));
    if (!Array.isArray(tasks) || !tasks.length) throw new Error("empty");
  } catch (_) {
    tasks = [{ slug: env("WORKFLOW_SLUG", "client-research"), tier: env("WORKFLOW_TIER", "normal"), prompt: env("WORKFLOW_PROMPT", "Research Acme Labs for a partnership call.") }];
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!bySlug[t.slug]) { console.error(`\nTask ${i + 1}: unknown workflow "${t.slug}", skipping.`); continue; }
    const tier = t.tier || "normal";
    console.log(`\n===== Task ${i + 1}/${tasks.length}: ${t.slug} [${tier}] =====`);
    try {
      const result = await core.payAndRun({
        circle, walletId, walletAddress, usdc, base, fundlineKey,
        slug: t.slug, tier, prompt: t.prompt || "", payMode,
      });
      console.log("paid: " + (result.priceUsdc || "?") + " USDC | settlement tx: " + (result.releaseTx || "(none)") + (result.explorerUrl ? " | " + result.explorerUrl : ""));
      console.log("--- output ---\n" + String(result.output || "").slice(0, 1500));
    } catch (e) {
      console.error("Task failed: " + e.message);
    }
  }
}

async function main() {
  const cmd = (process.argv[2] || "run").toLowerCase();
  if (cmd === "setup") return cmdSetup();
  if (cmd === "run") return cmdRun();
  console.error("Usage: node examples/circle-agent-demo.js [setup|run]");
  process.exit(1);
}

main().catch((e) => { console.error("Demo error:", e.message); process.exit(1); });
