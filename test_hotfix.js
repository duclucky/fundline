const { ethers } = require("ethers");

async function runTest() {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  const issuedAt = new Date().toISOString();
  const message = [
    "Sign in to Fundline",
    "",
    "This signature proves you control this wallet.",
    "It does not move funds or create an on-chain transaction.",
    "",
    `Issued at: ${issuedAt}`,
  ].join("\n");
  
  const signature = await wallet.signMessage(message);

  const authHeaders = {
    "x-fundline-wallet": address,
    "x-fundline-signature": signature,
    "x-fundline-issued-at": issuedAt,
    "Content-Type": "application/json"
  };

  console.log("1. Creating Product A (active)");
  const res1 = await fetch("http://127.0.0.1:5190/api/products", {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ title: "Product A", priceUSDC: 10, active: true })
  });
  const prod1 = (await res1.json()).product;

  console.log("2. Creating Product B (active)");
  const res2 = await fetch("http://127.0.0.1:5190/api/products", {
    method: "POST", headers: authHeaders,
    body: JSON.stringify({ title: "Product B", priceUSDC: 20, active: true })
  });
  const prod2 = (await res2.json()).product;

  console.log("3. Deactivating Product B");
  await fetch(`http://127.0.0.1:5190/api/products/${prod2.id}`, {
    method: "PATCH", headers: authHeaders,
    body: JSON.stringify({ active: false })
  });

  console.log("4. Fetching products as authenticated seller (should be 2)");
  const authRes = await fetch(`http://127.0.0.1:5190/api/products`, { headers: authHeaders });
  const authData = await authRes.json();
  console.log(`Authenticated count: ${authData.products.length}`);
  if (authData.products.length !== 2) throw new Error("Authenticated seller should see both products");

  console.log("5. Fetching products as public (should be 1)");
  const pubRes = await fetch(`http://127.0.0.1:5190/api/products?sellerId=${address}`);
  const pubData = await pubRes.json();
  console.log(`Public count: ${pubData.products.length}`);
  if (pubData.products.length !== 1) throw new Error("Public should only see active products");

  console.log("Test passed!");
}

runTest().catch(console.error);
