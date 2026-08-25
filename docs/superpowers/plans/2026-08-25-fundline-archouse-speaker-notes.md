# Fundline ArcHouse Speaker Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a polished English speaker script for the five-slide Fundline ArcHouse deck that can be delivered to the internal team in approximately five minutes.

**Architecture:** A single Markdown artifact contains one section per slide. Each section has a delivery objective, a complete spoken script, emphasis cues, and a transition; a final verification pass checks timing, slide coverage, and technical claim accuracy against the repository.

**Tech Stack:** Markdown, plain English, PowerShell, Node.js source checks.

## Global Constraints

- Create the final artifact at `D:\slide\fundline-archouse-speaker-notes.md`.
- Write the complete deliverable in English.
- Target 560 to 650 spoken words, excluding headings, objectives, emphasis notes, and transitions.
- Use a confident, conversational internal-team voice with `we`, `our`, and `Fundline`.
- Cover all five slides in deck order.
- State that Fundline is live on Arc Testnet, not mainnet.
- Say `nearly 30 live workflows` rather than asserting an unqualified count of 30.
- Describe AI arbitration as under development.
- Do not promise a mainnet date or use unsupported market statistics.
- Keep the exact protocol names `MCP`, `x402`, `Circle Gateway`, `CCTP`, and `escrow`.
- Use ASCII hyphens only; do not use em dashes or emojis.

---

### Task 1: Draft the Five-Slide Speaker Script

**Files:**
- Create: `D:\slide\fundline-archouse-speaker-notes.md`
- Reference: `D:\slide\fundline-archouse-deck\index.html`
- Reference: `docs-internal/fundline-pitch-qa.md`
- Reference: `docs/superpowers/specs/2026-08-25-fundline-archouse-speaker-notes-design.md`

**Interfaces:**
- Consumes: five slide topics, approved narrative, product facts, and timing constraints.
- Produces: five Markdown sections named `Slide 1` through `Slide 5`, each containing `Objective`, `Speaker script`, `Emphasize`, and, for slides 1 through 4, `Transition`.

- [ ] **Step 1: Run the pre-creation test and verify it fails**

Run:

```powershell
node -e 'const fs=require("fs"); const p="D:/slide/fundline-archouse-speaker-notes.md"; if(!fs.existsSync(p)) throw new Error("speaker_notes_missing");'
```

Expected: FAIL with `speaker_notes_missing` because the artifact does not exist yet.

- [ ] **Step 2: Write Slide 1, Product Thesis**

Use this content contract:

```text
Objective: Frame the shift from agents that reason to agents that can buy work and settle payments.
Required ideas: autonomous agents, paid work, USDC, Fundline as the product layer, Arc Testnet.
Emphasize: "buy work", "pay autonomously", "product layer".
Transition: Move from the thesis to the three product surfaces.
Target spoken length: 100 to 120 words.
```

- [ ] **Step 3: Write Slide 2, Product Scope and Positioning**

Use this content contract:

```text
Objective: Explain the connected products for people, agents, and settlement on Arc.
Required ideas: USDC invoicing, nearly 30 live workflows, non-custodial settlement, Circle owns the rails, Fundline builds the product layer.
Emphasize: "one system", "non-custodial", "product layer".
Transition: Move from what Fundline is to the exact agent run lifecycle.
Target spoken length: 120 to 140 words.
```

- [ ] **Step 4: Write Slide 3, Agent Run Lifecycle**

Use this content contract:

```text
Objective: Walk through discover, pay, run, and receive without overloading the audience with protocol detail.
Required ideas: list_workflows, tiered prices, x402 pay-per-call, gasless Circle Gateway, escrow refund on failure, run_workflow, Markdown and PDF result, agent-controlled wallet and keys.
Emphasize: "agent's own wallet", "refund on failure", "finished result".
Transition: Connect the same settlement principles to human invoicing.
Target spoken length: 130 to 150 words.
```

- [ ] **Step 5: Write Slide 4, Freelancer Invoice Lifecycle**

Use this content contract:

```text
Objective: Explain how a freelancer creates an invoice and receives verified USDC settlement.
Required ideas: public payment link, Arc payment or CCTP route, InvoicePaid verification, exact amount and recipient, Telegram and webhook notification, direct wallet-to-wallet funds, AI arbitration under development.
Emphasize: "verified on-chain", "wallet to wallet", "under development".
Transition: Move from product mechanics to immediate team actions.
Target spoken length: 120 to 140 words.
```

- [ ] **Step 6: Write Slide 5, Team Call to Action**

Use this content contract:

```text
Objective: Give the team two concrete test paths and define useful feedback.
Required ideas: agents use MCP plus x402, people use the invoice app, test friction, reliability, and clarity.
Emphasize: "test both paths", "friction", "reliability".
No transition after the final slide.
Target spoken length: 80 to 100 words.
```

- [ ] **Step 7: Verify the artifact structure**

Run:

```powershell
node -e 'const fs=require("fs"); const s=fs.readFileSync("D:/slide/fundline-archouse-speaker-notes.md","utf8"); const required=["## Slide 1","## Slide 2","## Slide 3","## Slide 4","## Slide 5","### Objective","### Speaker script","### Emphasize","### Transition"]; for(const x of required){if(!s.includes(x)) throw new Error("missing: "+x)} if((s.match(/^## Slide \d/gm)||[]).length!==5) throw new Error("slide_count"); console.log("PASS: five-slide speaker-note structure");'
```

Expected: `PASS: five-slide speaker-note structure`.

### Task 2: Verify Timing and Technical Accuracy

**Files:**
- Modify if required: `D:\slide\fundline-archouse-speaker-notes.md`

**Interfaces:**
- Consumes: complete five-slide draft from Task 1.
- Produces: a final script within the timing range and with all product-status claims qualified correctly.

- [ ] **Step 1: Run the timing check**

Count words only inside the five `Speaker script` blocks. Use a small read-only Node script that extracts text between `### Speaker script` and the next level-three heading.

```powershell
node -e 'const fs=require("fs"); const s=fs.readFileSync("D:/slide/fundline-archouse-speaker-notes.md","utf8"); const blocks=[...s.matchAll(/### Speaker script\s+([\s\S]*?)(?=\n### |\n## |$)/g)].map(m=>m[1]); const counts=blocks.map(b=>(b.match(/\b[\w''-]+\b/g)||[]).length); const total=counts.reduce((a,b)=>a+b,0); console.log({counts,total,minutesAt130Wpm:(total/130).toFixed(2)}); if(blocks.length!==5||total<560||total>650) throw new Error("timing_range");'
```

Expected: five block counts, a total between 560 and 650 words, and an estimated duration between 4.31 and 5.00 minutes at 130 words per minute. Pause and transition cues bring the delivered time close to five minutes.

- [ ] **Step 2: Run the technical claim check**

```powershell
node -e 'const fs=require("fs"); const s=fs.readFileSync("D:/slide/fundline-archouse-speaker-notes.md","utf8"); const required=["Arc Testnet","nearly 30 live workflows","MCP","x402","Circle Gateway","CCTP","escrow","under development","non-custodial"]; for(const x of required){if(!s.toLowerCase().includes(x.toLowerCase())) throw new Error("missing claim: "+x)} const forbidden=["live on mainnet","30 live workflows","AI arbitration is live"]; for(const x of forbidden){if(s.toLowerCase().includes(x.toLowerCase())) throw new Error("unsafe claim: "+x)} if(s.includes(String.fromCodePoint(0x2014))) throw new Error("em_dash"); if([...s].some(c=>c.codePointAt(0)>=0x1F300)) throw new Error("emoji"); console.log("PASS: technical claims and copy rules");'
```

Expected: `PASS: technical claims and copy rules`.

- [ ] **Step 3: Read the script aloud for flow**

Confirm that:

```text
Slide 1 opens with the market shift rather than a definition.
Slide 2 explains the three product surfaces and Circle positioning.
Slide 3 follows the four visible lifecycle steps in order.
Slide 4 follows the four visible invoice steps in order.
Slide 5 ends with an internal testing request.
Transitions do not repeat the next slide's opening sentence.
```

- [ ] **Step 4: Deliver the final artifact and the script in chat**

Provide a clickable link to `D:\slide\fundline-archouse-speaker-notes.md`, then reproduce the five speaker scripts in the response so the presenter can rehearse without opening another file.
