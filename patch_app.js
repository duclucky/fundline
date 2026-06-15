const fs = require('fs');

let code = fs.readFileSync('app.js', 'utf8');

// 1. hexToBigInt
code = code.replace(
  /function hexToBigInt\(value\) \{\s*const text = String\(value \|\| "0x0"\);\s*return \/\^0x\[0-9a-fA-F\]\*\$\/\.test\(text\) \? BigInt\(text \|\| "0x0"\) : 0n;\s*\}/,
  \`function hexToBigInt(value) {
  const text = String(value || "").trim();
  return /^0x[0-9a-fA-F]+$/.test(text) ? BigInt(text) : 0n;
}\`
);

// 2. payInvoiceWithWallet
code = code.replace(
  /const balance = await readUsdcBalance\(provider, config\.usdcTokenAddress, payerWallet\);/,
  'const balance = await readUsdcBalanceFromRpc(config.rpcUrl, config.usdcTokenAddress, payerWallet);'
);

code = code.replace(
  /resetPayWithWalletButton\(button, invoice\);\s*\}/,
  \`resetPayWithWalletButton(button, invoice);
    await refreshPaymentSourceStatus(id, { silent: true });
  }\`
);

// 3. _retryDirectPay
code = code.replace(
  /const balance = await readUsdcBalance\(provider, config\.usdcTokenAddress, payerWallet\);/,
  'const balance = await readUsdcBalanceFromRpc(config.rpcUrl, config.usdcTokenAddress, payerWallet);'
);

code = code.replace(
  /resetPayWithWalletButton\(button, invoice\);\s*\}/,
  \`resetPayWithWalletButton(button, invoice);
    await refreshPaymentSourceStatus(id, { silent: true });
  }\`
);

// 4. resetPayWithWalletButton
code = code.replace(
  /function resetPayWithWalletButton\(button, invoice\) \{([\s\S]*?)<\/\svg> Pay \$\{escapeHtml\(formatUsdc\(invoice\.total\)\)\} USDC\`;\n\}/,
  \`function resetPayWithWalletButton(button, invoice) {$1</svg> Pay \${escapeHtml(formatUsdc(invoice.total))} USDC\`;
  delete button.dataset.originalHtml;
}\`
);

fs.writeFileSync('app.js', code);
console.log('patched app.js');
