const sectionLinks = Array.from(document.querySelectorAll(".side-link, .on-page a"));
const sections = Array.from(document.querySelectorAll("main section[id]"));
const toast = document.querySelector("#copyToast");
let toastTimer = null;

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const target = document.querySelector(button.dataset.copy);
    const text = target?.innerText || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showCopyToast("Copied");
    } catch {
      showCopyToast("Copy failed");
    }
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible?.target?.id) return;
    setActiveLink(visible.target.id);
  },
  {
    rootMargin: "-18% 0px -66% 0px",
    threshold: [0.05, 0.2, 0.5],
  },
);

sections.forEach((section) => observer.observe(section));

function setActiveLink(id) {
  sectionLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
  });
}

function showCopyToast(message) {
  if (!toast) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 1500);
}
