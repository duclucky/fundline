redirectPaymentFallback();

const livePill = document.querySelector(".live-pill");
const statCards = document.querySelectorAll(".hero-stats article");

fetch("/api/config")
  .then((response) => (response.ok ? response.json() : null))
  .then((config) => {
    if (!config) return;
    if (livePill) {
      livePill.lastChild.textContent = config.onchainPaymentsEnabled
        ? " PaymentRouter live on Arc Testnet"
        : " Fundline ready on Arc Testnet";
    }
    if (statCards[1]) {
      statCards[1].querySelector("span").textContent = config.usdcTokenAddress ? "Native payment" : "Payment token";
    }
  })
  .catch(() => {});

function redirectPaymentFallback() {
  const match = window.location.pathname.match(/^\/pay\/([^/?#]+)/);
  if (!match) return;
  const invoiceId = encodeURIComponent(decodeURIComponent(match[1]));
  window.location.replace(`/app.html?pay=${invoiceId}`);
}
