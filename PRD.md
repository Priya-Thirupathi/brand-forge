# Product Requirements Document
## Project: BrandForge (working name) — AI Agent Brand & Feasibility Generator

> **Revision 3 — 2026-09-15.** Gemini free tier, semantic search and vector DB removed, TypeScript eval harness, staged roadmap without a fixed date. Rationale and rejected alternatives for every **[Dn]** are in `DECISIONS.md`.

### 1. Summary
BrandForge is a small end-to-end web app. A first-time founder picks a product category and material, then writes a one-sentence product idea. A chain of AI agents produces a brand kit — three name candidates (one selected), a tagline, a description, and packaging copy — grounded in an illustrative manufacturing estimate: material, per-unit cost range, minimum order quantity, lead time, and the cash needed for a first production run.

The estimate is looked up *before* generation and constrains what the copy may claim. Every run is logged step by step and checked against guardrails before anything is shown. An offline evaluation harness measures quality and proves, with confidence intervals, whether a prompt or model change helped or hurt. Past generations form a public gallery.

This is a portfolio project demonstrating full-stack product engineering around AI agents: the agent harness, the manufacturing constraints, and the product surface. It runs entirely on free-tier infrastructure.

### 2. Problem Statement
1. Turning a single unstructured idea into structured, trustworthy creative output using multiple coordinated AI agents, in a way that can be measured and improved over time rather than trusted on faith.
2. Bridging AI-generated creative output with real-world physical constraints (materials, cost, minimum order quantity, lead time), since a generated idea is only useful if it can plausibly become a real product.

### 3. Goals
- Demonstrate a working multi-agent LLM pipeline with guardrails, quality retries, and resilient handling of rate limits.
- Demonstrate generation that is *constrained* by feasibility data, not decorated with it afterwards. [D9]
- Demonstrate an evaluation harness that is provably sensitive: it flags a deliberate degradation with statistical confidence.
- Demonstrate full-stack craft: a clear streaming UI, a clean API and data model, layered code with tests, CI, and a deployment.
- Produce a live, shareable demo that is safe to leave running (no billing, bounded quota use, no exposed data), plus a recorded walkthrough.

### 4. Non-Goals
- Not a commercial product: no user accounts, payments, or production-scale data. All generations are public. [D6]
- No real supplier data. Feasibility numbers are illustrative and labelled that way.
- No model training or fine-tuning.
- No paid APIs. Gemini and Qwen (via Groq), both free tier — provider chosen by env, not a user-facing choice. [D2]
- No semantic search, embeddings, or vector database. [D14]
- No orchestration framework (LangChain etc.). [D24]
- No live quality scoring of user generations; quality is measured offline. [D4]
- No production-grade abuse prevention; demo-appropriate limits only. [D5]

### 5. Target User (for framing purposes)
A hypothetical first-time founder with a product idea — a beverage, supplement, skincare product, apparel item, or similar — and no manufacturing or branding experience, who wants a fast, structured starting point.

Secondary audience: a **reviewer** (hiring manager or engineer) evaluating the project from a link in a job application.

### 6. Core User Stories
1. As a user, I choose a category and a material from lists, enter a one-sentence idea, and receive three brand name candidates (one selected), a tagline, a description, and packaging copy. [D1, D8]
2. As a user, I see an illustrative feasibility estimate — material, per-unit cost range, minimum order quantity, lead-time range, and first-run cash needed — and the copy never claims a material the estimate doesn't assume. [D9]
3. As a user, I see progress step by step instead of a blank spinner. [D13]
4. As a user, I never see broken, empty, or policy-violating output. If a generation can't pass guardrails after a retry, I see which step failed and why, with a "Try again" action — never the failing content. [D7]
5. As a user, I'm told upfront that submitted ideas are stored and may appear publicly, so I don't enter anything confidential. [D6]
6. As a user who hits a usage limit or the demo's daily quota, I see a clear message, and the gallery still works. [D5, D21]
7. As a user, I can browse the public gallery of generated brands, filtered by category. [D6]
8. As a reviewer, I can open an "Under the hood" view showing recent runs: model per step, quality and transport retries, latency, tokens, and guardrail outcome.
9. As a reviewer, I can see the latest eval results versus the baseline. *(Stage 2)*
10. As a user, I can pick an alternate name candidate and regenerate the rest of the copy around it. *(Stage 5)* [D8]
11. As a user, I can add another product to a brand I generated, and its voice stays consistent with the first. *(Stage 5)* [D10]

### 7. Features by Stage

**Stage 1 — Core, running locally**
- Structured input: category and material dropdowns; idea text of 10–300 characters. [D1]
- Feasibility-first agent chain: feasibility lookup → naming (3 candidates) → tagline/description → packaging copy. [D9]
- Guardrails: banned words on input, plus the active provider's own safety feedback when it's Gemini (not available on Qwen/Groq — D2, D26); on output, schema shape, lengths and counts, banned words, regulated health/certification claims, material-claim consistency, famous-brand collisions, leaked placeholders. One quality retry with feedback per step. [D11, D17, D22]
- Transport retries for throttling and transient errors, bounded by the run deadline. [D21]
- Rejection, rate-limit, and quota-reached UI states. [D5, D7]
- Streaming progress per agent step. [D13]
- Persistence of runs, per-attempt step records, brands, and products in Postgres. [D20]
- Protections: per-IP and global generation limits, server-only database access with RLS. [D5, D15, D16]
- Single-page UI with tabs: *Generate*, *Gallery* (category filter), *Under the hood* (recent runs).
- Layered code with lint-enforced boundaries, unit and integration tests, CI. [D23]

**Stage 2 — Evaluation harness** [D3, D18]
- TypeScript CLI; versioned fixture of 20 generation cases (14 normal across all categories, 6 adversarial), 3 repeats each.
- Quota-aware: throttled pacing, resumable by case and repeat, able to span multiple days.
- Deterministic metrics plus LLM-judge rubric scores for relevance and distinctiveness.
- Stored eval runs and baselines; deltas with 95% confidence intervals.
- Sensitivity proof: a deliberately degraded naming prompt the harness must flag.
- Eval summary in *Under the hood*.

**Stage 3 — Deployment**
- Vercel + Neon-hosted Postgres; protections verified; global cap sized to the project's quota.

**Stage 4 — Presentation**
- README and architecture note, a 2-minute walkthrough recording, and a separate pitch write-up.

**Stage 5 — Extensions (in order, each independently demoable)**
1. ✅ Recorded-run replay: when the daily quota is exhausted, a visitor can watch a stored run stream with its original timings. [D28]
2. Brand follow-ups with tone memory, plus consistency eval cases. [D10]
3. Alternate-name regenerate. [D8]
4. Per-step routing experiment, strong vs. cheap model. [D12]
5. Judge calibration against 20 hand-labelled outputs.
6. Exact-match response caching to save quota.

### 8. Success Metrics (demo-appropriate)

| # | Metric | Target | Measured by |
|---|---|---|---|
| M1 | Shown outputs that pass all guardrails | 100% | Invariant in one response builder; unit-tested |
| M2 | Rejection rate on normal fixture cases | ≤ 10% | Eval harness |
| M3 | Adversarial fixture cases ending in their expected outcome | 18/18 (6 cases × 3 repeats) | Eval harness |
| M4 | Harness sensitivity | Degraded naming prompt flagged as a distinctiveness regression (95% CI of delta excludes 0) | Eval harness |
| M5 | Latency, submit → final result, succeeded runs **without** throttling | p50 ≤ 6 s, p95 ≤ 10 s; first progress event ≤ 1.5 s | Eval harness against the deployed app |
| M6 | Billing exposure | No billing account on either provider's project; the global cap is ≤ the active provider's daily quota ÷ 6 | Configuration checklist |

M1 and M2 are paired on purpose: M1 alone could be met by rejecting everything. Also reported without targets: first-attempt pass rate, quality retries per run, share of throttled runs, transport retries, and tokens per run.

### 9. Risks

| Risk | Mitigation |
|---|---|
| Free-tier quota is low, per project, and not guaranteed | Transport retries; global daily cap; quota-reached notice; Stage 5 recorded-run replay; resumable eval |
| Free-tier content may be used by the provider to improve its products (Gemini; Groq's Qwen terms differ) | **Not currently disclosed** — the Generate tab's notice covers storage/public-visibility/IP-hashing only, not this (found 2026-09-20 auditing D6; was never actually shipped despite this row previously claiming it was) |
| LLM output variability | Per-step quality retry with feedback; 3 name candidates; repeats and confidence intervals in eval |
| LLM judge bias (the provider judging its own output) | Pinned judge model, preferably a different generation than the generator; deterministic metrics alongside; Stage 5 calibration against human labels |
| Illustrative feasibility numbers mistaken for real quotes | "Illustrative estimate" label; every option carries a visible assumptions note |
| Prompt injection | Mitigated, not solved: idea isolated as delimited data, structured output, output guardrails, adversarial fixture cases |
| Offensive content passing guardrails into the public gallery | Gemini's safety filters when it's the active provider (not present on Qwen/Groq — D26); manual `hidden` flag; a new rule for each case found |
| Scope creep | Staged roadmap; each stage ships and is demoable before the next starts |

Items that still need a human decision are listed under "Open items" in `DECISIONS.md`.

### 10. Milestones
No fixed date. Effort estimates:

| Stage | Scope | Estimate |
|---|---|---|
| 1 | Core running locally, tests, CI | 25–35 h |
| 2 | Eval harness, sensitivity proof, first baseline | 10–15 h |
| 3 | Deployment and protections verified | 4–6 h |
| 4 | README, architecture note, walkthrough, pitch write-up | 5–8 h |
| 5 | Extensions, in order | 4–10 h each |
