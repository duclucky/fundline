/* ====================================================
   FUNDLINE HOME — Landing page JavaScript
   ==================================================== */

/* Run immediately on parse */
redirectPaymentFallback();
initHamburger();
initFaqAccordion();
initRevealObserver();
initNavHighlight();
initCtaAnalytics();
initScrollDepth();

/* ====================================================
   Existing: redirect /pay/:id to app
   ==================================================== */
function redirectPaymentFallback() {
  var match = window.location.pathname.match(/^\/pay\/([^/?#]+)/);
  if (!match) return;
  var invoiceId = encodeURIComponent(decodeURIComponent(match[1]));
  window.location.replace("/app.html?pay=" + invoiceId);
}

/* ====================================================
   Existing: fetch live config from server
   ==================================================== */
var livePill = document.getElementById("live-pill");

fetch("/api/config")
  .then(function (response) { return response.ok ? response.json() : null; })
  .then(function (config) {
    if (!config) return;
    if (livePill) {
      var textNode = livePill.lastChild;
      while (textNode && textNode.nodeType !== 3) {
        textNode = textNode.previousSibling;
      }
      if (textNode) {
        textNode.textContent = config.onchainPaymentsEnabled
          ? " Live on Arc Testnet"
          : " Fundline ready on Arc Testnet";
      }
    }
  })
  .catch(function () {});

/* ====================================================
   1. Hamburger menu
   ==================================================== */
function initHamburger() {
  var btn = document.getElementById("hamburger");
  var menu = document.getElementById("mobile-menu");
  if (!btn || !menu) return;

  btn.addEventListener("click", function () {
    var isOpen = btn.getAttribute("aria-expanded") === "true";
    setMenuOpen(!isOpen);
  });

  /* Close when a mobile link is clicked */
  menu.querySelectorAll(".mobile-link, .mobile-cta-btn").forEach(function (link) {
    link.addEventListener("click", function () {
      setMenuOpen(false);
    });
  });

  /* Close on Escape */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setMenuOpen(false);
  });

  /* Close when clicking outside */
  document.addEventListener("click", function (e) {
    if (
      btn.getAttribute("aria-expanded") === "true" &&
      !btn.contains(e.target) &&
      !menu.contains(e.target)
    ) {
      setMenuOpen(false);
    }
  });

  function setMenuOpen(open) {
    btn.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
    if (open) {
      menu.classList.add("is-open");
      document.body.style.overflow = "hidden";
    } else {
      menu.classList.remove("is-open");
      document.body.style.overflow = "";
    }
  }
}

/* ====================================================
   2. FAQ accordion
   ==================================================== */
function initFaqAccordion() {
  var questions = document.querySelectorAll(".faq-question");
  questions.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var isOpen = btn.getAttribute("aria-expanded") === "true";
      var answer = btn.nextElementSibling;

      /* Close all others */
      questions.forEach(function (other) {
        if (other === btn) return;
        other.setAttribute("aria-expanded", "false");
        var otherAnswer = other.nextElementSibling;
        if (otherAnswer) otherAnswer.hidden = true;
      });

      /* Toggle this one */
      btn.setAttribute("aria-expanded", String(!isOpen));
      if (answer) answer.hidden = isOpen;
    });
  });
}

/* ====================================================
   3. Scroll reveal (IntersectionObserver)
   ==================================================== */
function initRevealObserver() {
  if (!window.IntersectionObserver) {
    /* Fallback: show everything immediately */
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("is-visible");
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  document.querySelectorAll(".reveal").forEach(function (el, idx) {
    /* Stagger siblings inside the same grid */
    el.style.transitionDelay = (idx % 4) * 0.08 + "s";
    observer.observe(el);
  });
}

/* ====================================================
   4. Nav link active highlight on scroll
   ==================================================== */
function initNavHighlight() {
  var navLinks = document.querySelectorAll(".nav-link");
  if (!navLinks.length) return;

  var sections = [];
  navLinks.forEach(function (link) {
    var href = link.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    var target = document.getElementById(href.slice(1));
    if (target) sections.push({ link: link, section: target });
  });

  if (!sections.length) return;

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var match = sections.find(function (s) { return s.section === entry.target; });
        if (!match) return;
        if (entry.isIntersecting) {
          navLinks.forEach(function (l) { l.classList.remove("nav-link-active"); });
          match.link.classList.add("nav-link-active");
        }
      });
    },
    { threshold: 0.35 }
  );

  sections.forEach(function (s) { observer.observe(s.section); });
}

/* ====================================================
   5. CTA click analytics
   ==================================================== */

/*
 * Hero A/B variants (switch H1 to run a test):
 *   A (current):  "A transfer is not a confirmation."
 *   B (outcome):  "Get paid in USDC, with proof it actually arrived."
 *   C (chain):    "Your client is on another chain. Get paid anyway."
 * Rollback: git show 7f574cf:index.html restores P0 hero.
 */

function trackEvent(name, props) {
  /* Wire to your analytics tool:
     plausible(name, { props: props });
     gtag("event", name, props);        */
  console.log("[Fundline]", name, props || {});
}

function initCtaAnalytics() {
  var ctaIds = [
    "nav-cta",
    "hero-cta-primary",
    "hero-cta-secondary",
    "mobile-cta",
    "dev-cta-docs",
    "dev-cta-webhooks",
    "pricing-cta",
    "final-cta-primary",
    "final-cta-secondary",
  ];

  ctaIds.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", function () {
      trackEvent("cta_click", { id: id });
    });
  });
}

/* ====================================================
   6. Scroll depth tracking (25 / 50 / 75 / 100 %)
   ==================================================== */
function initScrollDepth() {
  var milestones = [25, 50, 75, 100];
  var reached = {};

  function checkDepth() {
    var scrolled = window.scrollY + window.innerHeight;
    var total = document.documentElement.scrollHeight;
    if (!total) return;
    var pct = Math.round((scrolled / total) * 100);
    milestones.forEach(function (m) {
      if (!reached[m] && pct >= m) {
        reached[m] = true;
        trackEvent("scroll_depth", { depth: m });
      }
    });
  }

  window.addEventListener("scroll", checkDepth, { passive: true });
}
