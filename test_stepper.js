const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // Navigate to home to get an invoice
  await page.goto('http://127.0.0.1:5190/');
  // Just go to a fake invoice if we can't find one, or create one
  // Actually, we can just hit the API to create an invoice
  const response = await fetch('http://127.0.0.1:5190/api/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchantWallet: "0x1111111111111111111111111111111111111111",
      amount: "10",
      description: "Test Invoice"
    })
  });
  const invoice = await response.json();
  console.log("Created invoice:", invoice.id);
  
  await page.goto(`http://127.0.0.1:5190/pay/${invoice.id}`);
  
  // Inject mock window.ethereum
  await page.evaluateOnNewDocument(() => {
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        console.log("Mock ETH called:", method, params);
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
          return ['0x2222222222222222222222222222222222222222'];
        }
        if (method === 'eth_chainId') {
          return '0x4cef52'; // Arc Testnet
        }
        if (method === 'eth_call') {
          // Mock USDC balance to be sufficient
          return '0x0000000000000000000000000000000000000000000000000000000000989680'; // 10,000,000 (10 USDC)
        }
        if (method === 'eth_sendTransaction') {
          return '0xabc123...'; // tx hash
        }
        if (method === 'eth_getTransactionReceipt') {
          return { status: '0x1' };
        }
        return null;
      },
      on: () => {},
      removeListener: () => {}
    };
  });
  
  await page.reload();
  await page.waitForSelector('#payWithWallet');
  
  console.log("Testing direct pay (Arc)...");
  await page.click('#refreshPaymentSource');
  await new Promise(r => setTimeout(r, 1000));
  
  let btnText = await page.$eval('#payWithWallet', el => el.textContent);
  console.log("Button after check:", btnText.trim());
  
  await page.click('#payWithWallet');
  await new Promise(r => setTimeout(r, 1000));
  
  const steps = await page.$$eval('.progress-step', steps => steps.map(s => ({
    label: s.querySelector('span')?.textContent,
    status: s.className,
    detail: s.querySelector('strong')?.textContent,
    hasRetry: !!s.querySelector('.progress-retry-btn')
  })));
  console.log("Progress steps:");
  console.log(steps);
  
  await browser.close();
})();
