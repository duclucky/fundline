const fs = require("fs");
const path = require("path");
const https = require("https");
const solc = require("solc");

// Verify FundlineRunEscrow source on Arcscan (Blockscout v2) via flattened-code.
// The contract is a single self-contained file, so the source is already flat.
// No API key or captcha is needed. Compiler version is read from the local solc
// so it matches the on-chain bytecode metadata.

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const CONTRACT_PATH = path.join(ROOT, "contracts", "FundlineRunEscrow.sol");

loadEnv(ENV_PATH);

const API_BASE = String(process.env.ARCSCAN_API_BASE || "https://testnet.arcscan.app/api/v2").trim();
const ADDRESS = String(process.env.ARC_RUN_ESCROW_ADDRESS || "").trim();
const COMPILER = `v${solc.version().replace(".Emscripten.clang", "")}`;

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

async function main() {
  if (!ADDRESS) throw new Error("Missing ARC_RUN_ESCROW_ADDRESS in .env");
  const source = fs.readFileSync(CONTRACT_PATH, "utf8");

  console.log(`Verifying FundlineRunEscrow at ${ADDRESS}`);
  console.log(`Compiler: ${COMPILER}`);
  console.log(`API: ${API_BASE}`);

  const body = {
    compiler_version: COMPILER,
    license_type: "mit",
    source_code: source,
    is_optimization_enabled: true,
    optimization_runs: 200,
    contract_name: "FundlineRunEscrow",
    evm_version: "default",
    autodetect_constructor_args: true,
    libraries: {},
  };

  const submit = await request(
    "POST",
    `${API_BASE}/smart-contracts/${ADDRESS}/verification/via/flattened-code`,
    body,
  );
  console.log(`Submit HTTP ${submit.status}: ${submit.body.slice(0, 300)}`);

  // Poll the contract endpoint until verified (Blockscout verifies async).
  for (let i = 0; i < 20; i += 1) {
    await sleep(3000);
    const info = await request("GET", `${API_BASE}/smart-contracts/${ADDRESS}`, null);
    let parsed = {};
    try { parsed = JSON.parse(info.body || "{}"); } catch {}
    if (parsed.is_verified || parsed.is_fully_verified) {
      console.log(`VERIFIED: name=${parsed.name || "?"} fully=${Boolean(parsed.is_fully_verified)}`);
      return;
    }
    console.log(`  ...not verified yet (attempt ${i + 1})`);
  }
  throw new Error("Timed out waiting for verification. Check Arcscan in a minute.");
}

function request(method, url, jsonBody) {
  return new Promise((resolve, reject) => {
    const payload = jsonBody ? JSON.stringify(jsonBody) : null;
    const u = new URL(url);
    const headers = { Accept: "application/json", "User-Agent": "FundlineVerify/1.0" };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error("Arcscan request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const sep = trimmed.indexOf("=");
    if (sep <= 0) return;
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}
