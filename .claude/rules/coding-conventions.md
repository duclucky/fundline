# Coding conventions and standing rules (hard requirements)

These are hard requirements. They apply to every change in this repo.

- Code, comments, UI copy, and project docs are in English. (`../../audit_report.md` is
  the one existing Vietnamese exception; do not add more non-English docs.)
- Do NOT use long em dashes anywhere in code, comments, or UI text.
- Do NOT attach icons or emojis to text on the website.
- Money is USDC with 6 decimals. Centralize decimal handling and avoid magic numbers.
  `10.50 USDC` is `10500000` base units. See `onchain-reference.md` for the decimal hazard.
- Non-custodial principle: no owner or admin path may withdraw user or escrowed funds.
  PaymentRouter only does `transferFrom(payer, merchant, amount)` and emits an event;
  it holds no balance. Flag any code that violates this invariant.
- Follow the existing style (CommonJS, two-space indent, double quotes, no semicolon
  removal). Do not introduce a new formatter or linter or restyle untouched code.
