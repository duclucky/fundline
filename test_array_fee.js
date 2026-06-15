const fs = require('fs');

const appJs = fs.readFileSync('app.js', 'utf8');

// Mock formatUnits
function formatUnits(value, decimals) {
  const raw = BigInt(String(value || "0x0"));
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fractionText ? `${whole.toLocaleString()}.${fractionText}` : whole.toLocaleString();
}

// Extract constants
const CCTP_STANDARD_FINALITY_THRESHOLD = 2000;
const CCTP_FAST_FINALITY_THRESHOLD = 1000;
const CCTP_IRIS_SANDBOX_BASE = "https://iris-api-sandbox.circle.com";
const ARC_USDC_DECIMALS = 6;

const match = appJs.match(/async function resolveCctpFee\([^\{]+\{[\s\S]*?\n\}/);
if (match) {
  eval(match[0]);

  (async () => {
    console.log("Testing with real API: Base Sepolia (6) to Arc (26)");

    // Test Fast API
    let res = await resolveCctpFee({ sourceDomain: 6, destinationDomain: 26, amountUnits: 10000000n, fast: true });
    console.log("Fast Result:", res);

    // Test Standard API
    res = await resolveCctpFee({ sourceDomain: 6, destinationDomain: 26, amountUnits: 10000000n, fast: false });
    console.log("Standard Result:", res);

  })();
} else {
  console.log("Failed to match resolveCctpFee in app.js");
}
