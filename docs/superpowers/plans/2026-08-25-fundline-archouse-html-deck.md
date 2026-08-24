# Fundline ArcHouse HTML Deck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained five-slide HTML presentation at `D:\slide\fundline-archouse-deck.html` that faithfully recreates the supplied Fundline deck in technically accurate English.

**Architecture:** One semantic HTML document contains all slide markup, CSS design tokens, responsive and print rules, and a small navigation controller. Each slide is a `section` inside a full-viewport stage; JavaScript controls active state, URL hash, keyboard, touch, and fullscreen behavior without external dependencies.

**Tech Stack:** HTML5, CSS3, vanilla JavaScript, PowerShell, Node.js syntax and DOM-independent source checks, Chromium visual inspection.

## Global Constraints

- Produce exactly one deliverable HTML file at `D:\slide\fundline-archouse-deck.html`.
- Recreate the slides with HTML and CSS; do not use the JPG files as slide backgrounds.
- Keep all CSS and JavaScript inline and require no network connection.
- Preserve the original black, warm gold, cream, and dark-card visual language.
- Use English for all UI copy and avoid em dashes and emojis.
- Keep USDC terminology, MCP tool names, x402, Gateway, CCTP, escrow, and Arc technically accurate.
- Support keyboard, pointer, touch, direct hash links, fullscreen, reduced motion, and print-to-PDF.
- Maintain accessible contrast, visible focus, semantic headings, and at least 44 by 44 pixel controls.

---

### Task 1: Build the Semantic Slide Deck and Visual System

**Files:**
- Create: `D:\slide\fundline-archouse-deck.html`
- Reference: `D:\slide\1.jpg`
- Reference: `D:\slide\2.jpg`
- Reference: `D:\slide\3.jpg`
- Reference: `D:\slide\4.jpg`
- Reference: `D:\slide\5.jpg`
- Reference: `docs/superpowers/specs/2026-08-25-fundline-archouse-html-deck-design.md`

**Interfaces:**
- Consumes: the approved five-slide English copy and visual requirements from the design spec.
- Produces: `.deck`, `.slide`, `.slide__inner`, `.card-grid`, `.flow-grid`, `.callout`, `.deck-controls`, and five slide sections with IDs `slide-1` through `slide-5`.

- [ ] **Step 1: Run the required UI design searches**

Run:

```powershell
python "C:\Users\TBC\.codex\skills\ui-ux-pro-max\scripts\search.py" "fintech pitch deck dark technical" --design-system -p "Fundline ArcHouse Deck"
python "C:\Users\TBC\.codex\skills\ui-ux-pro-max\scripts\search.py" "presentation keyboard reduced motion" --domain ux
python "C:\Users\TBC\.codex\skills\ui-ux-pro-max\scripts\search.py" "responsive presentation layout" --stack html-tailwind
```

Expected: the design-system result identifies a dark professional or technical presentation category, the UX result addresses keyboard or reduced-motion behavior, and the stack result provides responsive HTML guidance. Apply only results that preserve the supplied deck's established visual language.

- [ ] **Step 2: Run the pre-creation source check and verify it fails**

Run:

```powershell
node -e "const fs=require('fs'); const p='D:/slide/fundline-archouse-deck.html'; if(!fs.existsSync(p)) throw new Error('deck_missing');"
```

Expected: FAIL with `deck_missing` because the deliverable does not exist yet.

- [ ] **Step 3: Create the HTML structure and design tokens**

Create the document with this structural contract:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fundline | ArcHouse Regional Chapter Check-In</title>
  <style>
    :root {
      --bg: #090908;
      --surface: #17140f;
      --surface-strong: #1d1912;
      --border: #342a19;
      --accent: #f0bd59;
      --accent-strong: #ffc966;
      --text: #f4f0e8;
      --muted: #b9afa0;
      --focus: #ffe2a1;
      --stage-ratio: 16 / 9;
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#slide-1">Skip to presentation</a>
  <main class="deck" aria-label="Fundline ArcHouse presentation">
    <section class="slide is-active" id="slide-1" aria-labelledby="slide-1-title"></section>
    <section class="slide" id="slide-2" aria-labelledby="slide-2-title" hidden></section>
    <section class="slide" id="slide-3" aria-labelledby="slide-3-title" hidden></section>
    <section class="slide" id="slide-4" aria-labelledby="slide-4-title" hidden></section>
    <section class="slide" id="slide-5" aria-labelledby="slide-5-title" hidden></section>
  </main>
  <nav class="deck-controls" aria-label="Presentation controls"></nav>
  <p class="sr-only" id="slide-status" aria-live="polite"></p>
  <script></script>
</body>
</html>
```

Populate every section with the exact approved copy from the design spec. Use `.card-grid` for the three cards on slide 2, `.flow-grid` for the four steps on slides 3 and 4, and a two-column `.cta-grid` for slide 5. Use inline SVG only for navigation controls.

- [ ] **Step 4: Implement responsive and print CSS**

The CSS must include these behaviors:

```css
.slide {
  position: absolute;
  inset: 0;
  overflow: auto;
  background-color: var(--bg);
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 53px,
    rgba(240, 189, 89, 0.035) 54px,
    transparent 55px
  );
}

.deck-controls button {
  min-width: 44px;
  min-height: 44px;
}

button:focus-visible,
a:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 3px;
}

@media (max-width: 760px), (orientation: portrait) {
  .slide { position: fixed; }
  .card-grid,
  .flow-grid,
  .cta-grid { grid-template-columns: 1fr; }
  .slide__inner { min-height: 100%; padding: 72px 20px 112px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

@media print {
  @page { size: 16in 9in; margin: 0; }
  .deck-controls { display: none !important; }
  .deck { display: block; }
  .slide,
  .slide[hidden] {
    display: block !important;
    position: relative;
    width: 16in;
    height: 9in;
    break-after: page;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
}
```

- [ ] **Step 5: Run static content and structure checks**

Run:

```powershell
node -e "const fs=require('fs'); const s=fs.readFileSync('D:/slide/fundline-archouse-deck.html','utf8'); const req=['id=\"slide-1\"','id=\"slide-5\"','Agents buy, run, and pay autonomously.','Turn USDC payments into trusted business events.','How an agent buys and runs a workflow.','USDC invoicing for freelancers.','Get started in one minute.','@media print','prefers-reduced-motion']; for(const x of req){if(!s.includes(x)) throw new Error('missing: '+x)} if((s.match(/class=\"slide(?: |\")/g)||[]).length!==5) throw new Error('slide_count'); console.log('PASS: structure, copy, responsive, and print contracts');"
```

Expected: `PASS: structure, copy, responsive, and print contracts`.

- [ ] **Step 6: Commit the static deliverable checkpoint**

Do not commit `D:\slide\fundline-archouse-deck.html` because it is outside the repository. Record verification in the task summary instead.

### Task 2: Add Navigation, Accessibility, and Presentation Controls

**Files:**
- Modify: `D:\slide\fundline-archouse-deck.html`

**Interfaces:**
- Consumes: slide IDs `slide-1` through `slide-5`, control elements `previous-slide`, `next-slide`, and `fullscreen`, plus live region `slide-status`.
- Produces: `showSlide(index, source)`, `moveSlide(delta, source)`, `syncFromHash()`, keyboard navigation, touch navigation, URL hash updates, and fullscreen toggling.

- [ ] **Step 1: Run the interaction contract check and verify it fails**

Run:

```powershell
node -e "const fs=require('fs'); const s=fs.readFileSync('D:/slide/fundline-archouse-deck.html','utf8'); const req=['function showSlide','function moveSlide','hashchange','keydown','touchstart','requestFullscreen']; for(const x of req){if(!s.includes(x)) throw new Error('missing interaction: '+x)}"
```

Expected: FAIL because the interaction controller has not been added.

- [ ] **Step 2: Implement the navigation controller**

Add a controller with these exact public functions and event contracts:

```js
const slides = Array.from(document.querySelectorAll(".slide"));
let currentIndex = 0;
let touchStartX = null;

function showSlide(index, source = "pointer") {
  const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === nextIndex;
    slide.hidden = !active;
    slide.classList.toggle("is-active", active);
    slide.setAttribute("aria-hidden", String(!active));
  });
  currentIndex = nextIndex;
  history.replaceState(null, "", `#slide-${nextIndex + 1}`);
  document.getElementById("slide-status").textContent = `Slide ${nextIndex + 1} of ${slides.length}`;
  document.getElementById("previous-slide").disabled = nextIndex === 0;
  document.getElementById("next-slide").disabled = nextIndex === slides.length - 1;
  document.documentElement.style.setProperty("--progress", `${((nextIndex + 1) / slides.length) * 100}%`);
  if (source === "keyboard") {
    slides[nextIndex].querySelector("h1, h2").focus({ preventScroll: true });
  }
}

function moveSlide(delta, source = "pointer") {
  showSlide(currentIndex + delta, source);
}

function syncFromHash() {
  const match = location.hash.match(/^#slide-(\d+)$/);
  showSlide(match ? Number(match[1]) - 1 : 0, "hash");
}
```

Bind labeled Previous, Next, and Fullscreen buttons. Map `ArrowLeft` and `PageUp` to previous; `ArrowRight`, `PageDown`, and `Space` to next; `Home` to the first slide; and `End` to the last slide. Ignore navigation keys when the event target is an input, textarea, select, button, or link. Detect a horizontal touch difference of at least 50 pixels before moving slides. Listen for `hashchange`. Toggle fullscreen with `document.documentElement.requestFullscreen()` and `document.exitFullscreen()`.

- [ ] **Step 3: Run interaction and source-safety checks**

Run:

```powershell
node -e "const fs=require('fs'); const s=fs.readFileSync('D:/slide/fundline-archouse-deck.html','utf8'); const req=['function showSlide','function moveSlide','function syncFromHash','hashchange','keydown','touchstart','touchend','requestFullscreen','exitFullscreen','aria-live=\"polite\"','focus-visible']; for(const x of req){if(!s.includes(x)) throw new Error('missing: '+x)} if(s.includes(String.fromCodePoint(0x2014)) || [...s].some((c)=>c.codePointAt(0)>=0x1F300)) throw new Error('forbidden character'); console.log('PASS: interaction and source-safety contracts');"
```

Expected: `PASS: interaction and source-safety contracts`.

- [ ] **Step 4: Open the deck in Chromium and inspect behavior**

Open `file:///D:/slide/fundline-archouse-deck.html` and verify:

1. Slides 1 through 5 render with the correct English copy.
2. Previous, Next, keyboard, touch, direct hashes, and fullscreen work.
3. Disabled controls are visually clear.
4. Focus remains visible and slide changes are announced.
5. No console errors occur.

Expected: all behaviors pass without console errors.

### Task 3: Visual and Responsive Verification

**Files:**
- Modify if needed: `D:\slide\fundline-archouse-deck.html`

**Interfaces:**
- Consumes: complete deck from Tasks 1 and 2.
- Produces: final verified presentation with no horizontal overflow and reliable PDF printing.

- [ ] **Step 1: Capture desktop and mobile screenshots**

Render slide 1 and at least one content-heavy slide at:

- 1920 by 1080
- 1366 by 768
- 375 by 812
- 812 by 375

Expected: desktop layouts preserve the reference 16:9 composition; portrait mobile stacks cards vertically; mobile landscape remains readable with scroll available when necessary.

- [ ] **Step 2: Correct visual mismatches with token-level changes**

Limit corrections to semantic tokens and existing layout rules:

```css
:root {
  --bg: #090908;
  --surface: #17140f;
  --border: #342a19;
  --accent: #f0bd59;
  --text: #f4f0e8;
  --muted: #b9afa0;
}
```

Adjust typography with `clamp()`, grid gaps, card padding, and stage padding. Do not add dependencies, decorative images, or new UI patterns.

- [ ] **Step 3: Verify overflow and reduced motion**

In Chromium DevTools, test the four target sizes and emulate `prefers-reduced-motion: reduce`.

Expected: `document.documentElement.scrollWidth === window.innerWidth`, no content is clipped, controls remain reachable, and slide transitions become effectively instant under reduced motion.

- [ ] **Step 4: Verify print output**

Open the print preview using landscape orientation and background graphics.

Expected: exactly five pages, one slide per page, no navigation controls, and preserved dark backgrounds and gold accents.

- [ ] **Step 5: Run the final verification command**

Run:

```powershell
node -e "const fs=require('fs'); const p='D:/slide/fundline-archouse-deck.html'; const s=fs.readFileSync(p,'utf8'); const checks={slides:(s.match(/class=\"slide(?: |\")/g)||[]).length===5,english:!/[À-ỹ]/u.test(s),offline:!/<(?:script|link)[^>]+(?:src|href)=\"https?:/i.test(s),print:s.includes('@media print'),motion:s.includes('prefers-reduced-motion'),hash:s.includes('hashchange'),fullscreen:s.includes('requestFullscreen')}; const failed=Object.entries(checks).filter(([,ok])=>!ok).map(([name])=>name); if(failed.length) throw new Error('failed: '+failed.join(',')); console.log('PASS', checks);"
```

Expected: every property prints as `true` and the command exits with code 0.

- [ ] **Step 6: Deliver the artifact**

Provide a clickable link to `D:\slide\fundline-archouse-deck.html`, summarize navigation keys, and report the exact verification evidence. Do not claim completion until the final command and visual checks pass.
