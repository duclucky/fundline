"use strict";

// Pre-deploy surface audit for FundlineRunEscrow. Compiles the contract and asserts
// the ABI exposes exactly the intended interface, has NO privileged fund-movement /
// owner / withdraw / fee / selfdestruct path, no payable (msg.value) functions, and
// that the InvoiceMemo event topic0 matches FundlineMemoRouter. The full on-chain
// fund/release/refund/claimRefund lifecycle is exercised by a testnet dry-run at
// deploy time (needs keys); this test runs offline. Run: node test_run_escrow.js

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { id } = require("ethers");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}

const ROOT = __dirname;
const CONTRACT_PATH = path.join(ROOT, "contracts", "FundlineRunEscrow.sol");

function compile() {
  const source = fs.readFileSync(CONTRACT_PATH, "utf8");
  const input = {
    language: "Solidity",
    sources: { "FundlineRunEscrow.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors || []).filter((e) => e.severity === "error");
  if (fatal.length) throw new Error(fatal.map((e) => e.formattedMessage || e.message).join("\n"));
  const c = output.contracts["FundlineRunEscrow.sol"].FundlineRunEscrow;
  return { abi: c.abi, bytecode: c.evm.bytecode.object, source };
}

const { abi, bytecode, source } = compile();
check("compiles to bytecode", typeof bytecode === "string" && bytecode.length > 0);

const fns = abi.filter((x) => x.type === "function");
const fnNames = fns.map((x) => x.name);
const events = abi.filter((x) => x.type === "event").map((x) => x.name);

// Expected interface present
["fund", "release", "refund", "claimRefund", "getRun", "runs", "usdc", "treasury", "REFUND_WINDOW"].forEach((n) => {
  check(`has function ${n}`, fnNames.includes(n));
});
["RunFunded", "RunReleased", "RunRefunded", "InvoiceMemo"].forEach((n) => {
  check(`has event ${n}`, events.includes(n));
});

// No privileged / dangerous surface (substring match, case-insensitive)
const forbidden = ["owner", "admin", "withdraw", "sweep", "rescue", "drain", "seize", "setfee", "fee", "settreasury", "settreasur", "pause", "mint", "upgrade", "destroy", "kill"];
fnNames.forEach((n) => {
  const low = n.toLowerCase();
  forbidden.forEach((bad) => check(`no privileged function (${n} vs ${bad})`, !low.includes(bad)));
});

// No payable functions (no msg.value path)
fns.forEach((f) => check(`function ${f.name} is not payable`, f.stateMutability !== "payable"));
check("no receive/fallback payable", !abi.some((x) => (x.type === "receive" || x.type === "fallback") && x.stateMutability === "payable"));

// Constructor takes (address, address)
const ctor = abi.find((x) => x.type === "constructor");
check("constructor present", Boolean(ctor));
check("constructor takes two address args", Boolean(ctor) && ctor.inputs.length === 2 && ctor.inputs.every((i) => i.type === "address"));

// release takes (bytes32, bytes); fund takes (bytes32, uint256)
const release = fns.find((f) => f.name === "release");
check("release(bytes32,bytes)", release && release.inputs.length === 2 && release.inputs[0].type === "bytes32" && release.inputs[1].type === "bytes");
const fund = fns.find((f) => f.name === "fund");
check("fund(bytes32,uint256)", fund && fund.inputs.length === 2 && fund.inputs[0].type === "bytes32" && fund.inputs[1].type === "uint256");

// InvoiceMemo topic0 byte-matches FundlineMemoRouter's event signature
const MEMO_TOPIC = id("InvoiceMemo(bytes32,address,bytes)");
const ev = abi.find((x) => x.type === "event" && x.name === "InvoiceMemo");
const evSig = ev ? `InvoiceMemo(${ev.inputs.map((i) => i.type).join(",")})` : "";
check("InvoiceMemo signature is (bytes32,address,bytes)", evSig === "InvoiceMemo(bytes32,address,bytes)");
check(`InvoiceMemo topic0 matches memo router (${MEMO_TOPIC})`, id(evSig) === MEMO_TOPIC);

// Source-level guards against custody escape hatches. Match the CALL form (with
// "(") so the word appearing in an explanatory comment does not false-positive.
const lowerSrc = source.toLowerCase().replace(/\s+/g, "");
["selfdestruct(", "delegatecall(", "suicide("].forEach((bad) => {
  check(`source has no ${bad}`, !lowerSrc.includes(bad));
});
// release must target the immutable treasury, refund must target the run's payer (sanity on source)
check("release transfers to treasury", /transfer\(treasury,/.test(source));
check("refund transfers to payer", /transfer\(payer, amount\)/.test(source) || /transfer\(run\.payer/.test(source));

console.log(`\nrun escrow surface test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
