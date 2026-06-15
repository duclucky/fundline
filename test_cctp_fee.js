const fs = require('fs');

const appJs = fs.readFileSync('app.js', 'utf8');
const fetch = global.fetch;

// Mock constants
const CCTP_FAST_FINALITY_THRESHOLD = 500;
const CCTP_STANDARD_FINALITY_THRESHOLD = 1000;
const CCTP_IRIS_SANDBOX_BASE = 'https://iris-api-sandbox.circle.com';
const ARC_USDC_DECIMALS = 6;

function formatUnits(value, decimals) {
  const raw = BigInt(String(value || "0x0"));
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fractionText ? `${whole.toLocaleString()}.${fractionText}` : whole.toLocaleString();
}

// Extract resolveCctpFee
const match = appJs.match(/async function resolveCctpFee\([^\{]+\{[\s\S]*?\n\}/);
if (match) {
  eval(match[0]);
  
  (async () => {
    console.log("Testing resolveCctpFee...");
    // Test Fast API
    let res = await resolveCctpFee({ sourceDomain: 0, destinationDomain: 7, amountUnits: 10000000n, fast: true });
    console.log("Fast:", res);
    
    // Test Standard API
    res = await resolveCctpFee({ sourceDomain: 0, destinationDomain: 7, amountUnits: 10000000n, fast: false });
    console.log("Standard:", res);
    
    // Test API Failure + Fast (Mock fetch to fail)
    const oldFetch = global.fetch;
    global.fetch = () => Promise.reject(new Error("Network Error"));
    res = await resolveCctpFee({ sourceDomain: 0, destinationDomain: 7, amountUnits: 10000000n, fast: true });
    console.log("Fast with API failure (should downgrade to standard):", res);
    global.fetch = oldFetch;
    
  })();
} else {
  console.log("Could not find resolveCctpFee");
}
