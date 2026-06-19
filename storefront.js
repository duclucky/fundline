const sellerId = window.location.pathname.replace('/s/', '').replace('/', '');
const els = {
  sellerWallet: document.getElementById('sellerWallet'),
  productsList: document.getElementById('productsList')
};

function shortenAddress(address) {
  if (!address) return "";
  return address.slice(0, 6) + "..." + address.slice(-4);
}

els.sellerWallet.textContent = "Seller: " + shortenAddress(sellerId);

async function loadProducts() {
  try {
    const res = await fetch(`/api/products?sellerId=${sellerId}`);
    const data = await res.json();
    
    if (data.products.length === 0) {
      els.productsList.innerHTML = '<p style="text-align: center;">No active products available.</p>';
      return;
    }

    els.productsList.innerHTML = data.products.map(p => `
      <div class="invoice-row" style="padding: 24px;">
        <div class="invoice-info">
          <strong class="invoice-title" style="font-size: 1.25rem; margin-bottom: 8px;">${p.title}</strong>
          <span class="invoice-meta" style="font-size: 1rem;">${p.priceUSDC} USDC &bull; ${p.description || ''}</span>
        </div>
        <div class="invoice-status">
          <button class="primary-action" onclick="buyProduct('${p.id}')">Buy</button>
        </div>
      </div>
    `).join('');
    
    window.products = data.products;
  } catch (err) {
    els.productsList.innerHTML = '<p style="text-align: center;">Error loading products.</p>';
  }
}

window.buyProduct = async function(productId) {
  const p = window.products.find(x => x.id === productId);
  if (!p) return;

  const invoicePayload = {
    merchantWallet: sellerId,
    items: [
      {
        description: p.title,
        quantity: 1,
        unitPrice: p.priceUSDC
      }
    ]
  };

  try {
    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create invoice');
    
    // Redirect to the 5-step smart pay flow
    window.location.href = `/pay/${data.invoice.id}`;
  } catch (err) {
    alert(err.message);
  }
};

loadProducts();
