# Fundline ArcHouse HTML Deck Design

## Objective

Create a self-contained, five-slide HTML presentation from the supplied Vietnamese reference images. The deck must preserve the original Fundline visual language while translating the content into concise, technically accurate English.

Output file:

`D:\slide\fundline-archouse-deck.html`

## Visual Direction

- Preserve the supplied 16:9 composition, near-black background, warm gold accent, cream display type, subtle horizontal grid lines, and dark bordered cards.
- Recreate the design with HTML and CSS. Do not embed the supplied JPG files as slide backgrounds.
- Use system font stacks so the deck works offline without external downloads.
- Keep typography bold and presentation-scale while maintaining readable body copy and accessible contrast.
- Use semantic design tokens for background, surface, border, primary text, secondary text, and accent colors.

## Slide Content

### Slide 1: Cover

- Eyebrow: `ARCHOUSE  ·  REGIONAL CHAPTER CHECK-IN  ·  23.07.2026`
- Brand: `Fundline`
- Headline: `Agents buy, run, and pay autonomously.`
- Supporting copy: `An AI workflow marketplace for agents and USDC invoicing for freelancers. Built on Arc.`

### Slide 2: What Fundline Is

- Section label: `WHAT IS FUNDLINE?`
- Headline: `Turn USDC payments into trusted business events.`
- Human card:
  - Label: `FOR PEOPLE`
  - Title: `USDC Invoicing`
  - Copy: `Freelancers issue invoices and clients pay in USDC from an Arc wallet or through CCTP. Fundline verifies settlement on-chain and sends an immediate notification.`
- Agent card:
  - Label: `FOR AGENTS`
  - Title: `AI Workflow Marketplace`
  - Copy: `Thirty priced workflows. Agents discover and pay per run through MCP, with no account required.`
- Arc card:
  - Label: `ON ARC`
  - Title: `Non-Custodial Settlement`
  - Copy: `Funds move directly between wallets and settle in under a second. Fundline verifies payment without taking custody.`
- Technical line: `LIVE ON ARC TESTNET  ·  INVOICING + 30 WORKFLOWS  ·  MCP AT /MCP  ·  WALLET / CCTP / X402 / GATEWAY / ESCROW`
- Positioning note: `Fundline does not compete with Circle. Circle provides the payment rails through Gateway and x402. Fundline is the product layer where people and agents transact.`

### Slide 3: Agent Workflow

- Section label: `HOW IT WORKS`
- Headline: `How an agent buys and runs a workflow.`
- Step 1:
  - Title: `Discover`
  - Command: `list_workflows`
  - Copy: `The agent calls Fundline through MCP, receives available workflows and tiered prices, then selects a slug and tier.`
- Step 2:
  - Title: `Pay`
  - Command: `x402 / Gateway / escrow`
  - Copy: `Payment comes from the agent's own wallet. x402 returns a payment challenge, Gateway is gasless, and escrow refunds failed runs.`
- Step 3:
  - Title: `Run`
  - Command: `run_workflow`
  - Copy: `Fundline orchestrates the required models and executes the multi-step workflow.`
- Step 4:
  - Title: `Receive the Result`
  - Command: `Markdown + PDF`
  - Copy: `Fundline returns machine-readable Markdown and a PDF link. For escrow runs, payment is released to the treasury after successful delivery.`
- Trust note: `Fundline never holds the agent's wallet or funds. The agent controls its keys and pays directly on-chain, with sub-second settlement on Arc.`

### Slide 4: USDC Invoicing

- Section label: `USDC INVOICING`
- Headline: `USDC invoicing for freelancers.`
- Step 1:
  - Title: `Create an Invoice`
  - Command: `/pay link`
  - Copy: `Enter the amount, due date, and line items. Receive a public payment link and QR code immediately.`
- Step 2:
  - Title: `Client Pays`
  - Command: `wallet / CCTP`
  - Copy: `The client pays with USDC on Arc or bridges USDC from Ethereum or Base through CCTP.`
- Step 3:
  - Title: `Verify On-Chain`
  - Command: `InvoicePaid`
  - Copy: `Fundline reads the payment event on Arc, validates the amount and recipient, and marks the invoice as paid.`
- Step 4:
  - Title: `Notify and Reconcile`
  - Command: `Telegram + webhook`
  - Copy: `Fundline sends an immediate notification. Batch payouts can settle multiple recipients in one transaction.`
- Trust note: `Funds move directly from the client to the freelancer. Fundline verifies settlement without taking custody. In development: AI arbitration for agent-to-agent disputes.`

### Slide 5: Call to Action

- Section label: `TRY IT`
- Headline: `Get started in one minute.`
- Agent card:
  - Label: `FOR AGENTS`
  - Title: `MCP + x402`
  - Endpoint: `fundline.xyz/mcp  ·  /llms.txt`
  - Copy: `A funded wallet is all an agent needs. No account is required, and payment comes directly from the agent's wallet.`
- Human card:
  - Label: `FOR PEOPLE`
  - Title: `Create an Invoice`
  - Endpoint: `fundline.xyz/app`
  - Copy: `Connect a wallet, create a USDC invoice, and send the payment link to your client.`

## Interaction Model

- Display one slide at a time in a full-viewport stage.
- Support Previous and Next buttons with visible labels and at least 44 by 44 pixel hit areas.
- Support `ArrowLeft`, `ArrowRight`, `PageUp`, `PageDown`, `Space`, `Home`, and `End` keyboard controls.
- Support touch swipes without making swipe the only navigation method.
- Display the current slide number and a progress indicator.
- Provide a visible fullscreen control using an inline SVG icon and accessible name.
- Update the URL hash to `#slide-N` so a slide can be linked directly.
- Keep focus visible and move it to the active slide heading after navigation only when navigation originated from the keyboard.

## Responsive Behavior

- Desktop and landscape presentation mode preserve a 16:9 visual stage.
- The stage scales to fit the available viewport without horizontal scrolling.
- On narrow portrait screens, each slide becomes vertically scrollable and cards stack in reading order.
- Body text remains at least 16 pixels on small screens.
- Long endpoints and technical identifiers may wrap safely.

## Motion and Accessibility

- Use a short directional fade and translation between slides.
- Animate only opacity and transform.
- Disable nonessential transitions under `prefers-reduced-motion: reduce`.
- Use semantic sections, headings, buttons, `aria-live` slide status, and descriptive control labels.
- Maintain at least WCAG AA contrast for normal text and visible keyboard focus indicators.

## Print and Offline Support

- Keep CSS and JavaScript inline in the single HTML file.
- Do not require a network connection or external package.
- Print each slide on a separate landscape page with controls hidden.
- Preserve backgrounds and colors when printing to PDF.

## Verification

- Validate that the HTML loads without console errors.
- Verify all five slides and all translated copy against this specification.
- Test keyboard, click, hash navigation, and fullscreen behavior.
- Test at 1920x1080, 1366x768, 375x812, and mobile landscape dimensions.
- Test the reduced-motion media query and print stylesheet.
- Confirm the page has no horizontal overflow at supported sizes.
