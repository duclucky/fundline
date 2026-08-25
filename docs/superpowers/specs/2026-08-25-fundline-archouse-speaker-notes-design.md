# Fundline ArcHouse Speaker Notes Design

## Objective

Create a concise English speaking script for the five-slide Fundline ArcHouse deck. The script is for an internal team presentation and should take approximately five minutes to deliver.

## Audience and Voice

- Audience: the Fundline team, including product and technical contributors.
- Voice: confident, conversational, technically accurate, and easy to speak aloud.
- Point of view: use `we`, `our`, and `Fundline` consistently.
- Avoid investor-style hype, unexplained jargon, and claims not supported by the repository.
- Do not read slide text verbatim. Explain why each point matters and connect it to the next slide.

## Timing

- Total target: approximately five minutes.
- Slide 1: 45 to 55 seconds.
- Slide 2: 55 to 65 seconds.
- Slide 3: 60 to 70 seconds.
- Slide 4: 55 to 65 seconds.
- Slide 5: 35 to 45 seconds.

## Output Structure

Each slide will include:

1. A delivery objective in one sentence.
2. A complete English speaker script.
3. Two or three words or phrases to emphasize.
4. A natural transition to the next slide, except after the final slide.

## Narrative

### Slide 1: Product Thesis

Open with the shift from AI agents that only reason to agents that can independently purchase work and settle payments. Position Fundline as the product layer for agent workflows and USDC invoicing on Arc.

### Slide 2: Product Scope and Positioning

Explain the three connected surfaces:

- USDC invoicing for people.
- A paid AI workflow catalog for agents.
- Non-custodial settlement on Arc.

Clarify that Circle provides payment rails such as Gateway and x402, while Fundline provides the products and business workflows running on those rails.

### Slide 3: Agent Run Lifecycle

Walk through discovery, payment, execution, and delivery. Explain the purpose of x402, Gateway, and per-run escrow without turning the talk into a protocol deep dive. Reinforce that the agent controls its wallet and keys.

### Slide 4: Freelancer Invoice Lifecycle

Explain invoice creation, payment from Arc or through CCTP, on-chain verification, and notifications through Telegram or webhooks. Present AI arbitration as an area under development, not a live production capability.

### Slide 5: Call to Action

End with two immediate paths: agents can connect through MCP and x402, while people can create a USDC invoice through the app. Ask the team to test both paths and focus feedback on friction, reliability, and clarity.

## Technical Claim Guardrails

- State that the product is live on Arc Testnet, not mainnet.
- Say `nearly 30 live workflows` because the deck says 30 while the current public homepage says 27.
- Describe x402 as pay-per-call, Gateway as gasless for frequent payments, and escrow as refunding a funded run when execution fails.
- Describe CCTP as the cross-chain route from supported source networks to Arc.
- State that funds move wallet to wallet and that Fundline verifies settlement without taking custody.
- Do not imply that AI arbitration is already live.
- Do not promise a mainnet date.
- Avoid external market statistics that are not needed for this internal five-minute talk.

## Delivery Style

- Use short sentences and contractions where they sound natural.
- Keep protocol names exact: `MCP`, `x402`, `Circle Gateway`, `CCTP`, and `escrow`.
- Include light pause cues only where they help delivery.
- Use emphasis notes sparingly so the script remains readable.
- End with a direct internal-team action rather than a generic sales closing.

## Acceptance Criteria

- The full script can be spoken in approximately five minutes at a normal pace.
- All five slides have complete speaker notes and clear transitions.
- The script is understandable to both product and engineering team members.
- Every product-status claim matches the current repository or is clearly qualified.
- The final output is fully in English.
