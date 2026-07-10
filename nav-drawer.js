"use strict";

// Shared mobile nav drawer for the app shell (app.html, workflows.html, dashboard.html).
// On narrow screens the sidebar (.side) becomes an off-canvas drawer toggled by a floating
// hamburger button. All layout is driven by CSS (styles.css); this script only injects the
// button and overlay and toggles the "nav-open" class on body. No dependencies.
(function () {
  "use strict";

  function init() {
    var shell = document.querySelector(".shell");
    var side = shell ? shell.querySelector(".side") : null;
    if (!shell || !side) return;
    if (document.querySelector(".nav-toggle")) return; // already set up

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

    var overlay = document.createElement("div");
    overlay.className = "nav-overlay";

    function open() {
      document.body.classList.add("nav-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
    }
    function close() {
      document.body.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
    }
    function toggleOpen() {
      if (document.body.classList.contains("nav-open")) close();
      else open();
    }

    toggle.addEventListener("click", toggleOpen);
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close();
    });

    // Close the drawer once the user picks a destination (a link or a view button),
    // but not when they only expand a nav group.
    side.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("a, .nav-item") : null;
      if (target) close();
    });

    document.body.appendChild(overlay);
    document.body.appendChild(toggle);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
