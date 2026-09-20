# Decision Log — BrandForge

Each entry records the decision, why it was made, and the alternatives that were rejected (with reasons). `PRD.md` and `TRD.md` reference entries as **[Dn]**. Entries marked **Revised** say what changed and why; the log keeps the history rather than silently rewriting it.

---

### D1 — Category and material are chosen from dropdowns
**Decision:** The user picks a category (10 options) and one of that category's material options. The product idea stays free text.

**Why:** Category + material is the join key into feasibility data. A dropdown makes the lookup deterministic, guarantees an estimate always exists, and makes the material-consistency guardrail exact.

**Rejected:**
- *LLM infers category from the idea* — an extra LLM call (and free-tier quota) plus a silent failure mode: a wrong or invented slug yields the wrong estimate.
- *Category only, one material per category* — a user who types "bamboo water bottle" would get stainless-steel copy and costs, contradicting their own idea.

---

### D2 — Only free-tier LLM providers, selected by `LLM_PROVIDER`
**Revised 2026-09-15:** was OpenAI. Changed because the project runs on free-tier keys only.

**Revised 2026-09-20:** was "Gemini is the only provider, enforced by a `NODE_ENV` check that kept the Qwen/Groq adapter (D26) from ever running in a deployed build." That enforcement is gone — `LLM_PROVIDER=qwen` now selects Qwen in any environment, including production, and the live deployed demo currently runs on it. Reason: Gemini's daily quota kept getting exhausted, including in the deployed demo itself, not just local testing sessions — see D26's "Why" for the same observation made about local dev. Gemini remains fully supported and is the default when `LLM_PROVIDER` is unset. **Consequence worth knowing:** D22's Gemini-safety-feedback moderation layer doesn't exist on Qwen/Groq, so while Qwen is the active provider, `input.safety`/`output.safety` rejections never fire — the app's own banned-word/regulated-claims/famous-brand checks (not provider-dependent) still do.

**Decision:** All generation (and, in Stage 2, judging) uses one of two free-tier `LlmClient` implementations, chosen by `LLM_PROVIDER` (`lib/adapters/createLlmClient.ts`): Gemini via `@google/genai`, on a Google Cloud project with **no billing account** (`strong` default `gemini-3.8-flash`, `cheap` default `gemini-3.5-flash-lite`); or Qwen via Groq's free tier (`qwen/qwen3.8-27b`, D26). Token counts are recorded for either; dollar cost is not tracked because it is always $0 on both.

**Why:**
- Neither provider can incur charges on these keys, so a public demo link has zero spend risk regardless of which is active.
- Both Gemini tiers are stable models on the free tier and support JSON-schema structured output.
- Quota (requests per minute/day, per project), not money, becomes the constraint the design has to respect — see D5, D16, D21, D22, D26.

**Rejected:**
- *OpenAI* — paid only.
- *Tracking estimated cost* — every value would be 0 on either free tier; token counts carry the same information for later analysis.

**Accepted trade-off:** Google's pricing page states free-tier content is "Used to improve our products" — true only while Gemini is the active provider. The UI's disclosure (D6) doesn't name either provider, so this doesn't need updating each time `LLM_PROVIDER` changes. Whichever provider is active, moderation coverage differs per the note above.

---

### D3 — The eval harness is a TypeScript CLI in this repo, sharing its logic with an in-app trigger
**Revised 2026-09-15:** was a Python CLI using DeepEval. Changed for a single-language full-stack codebase and the Gemini switch.
**Revised 2026-09-17:** `POST /api/eval/run` now exists (below) — narrowed, not reversed.
**Revised 2026-09-18:** the route's background-task gap (below) is fixed — it's now Vercel-safe.

**Decision:** Stage 2's harness logic (`lib/eval/{fixture,judge,runner,stats,aggregate}.ts`) calls the app's `/api/generate` over HTTP, scores results (deterministic metrics + an LLM-judge rubric), and stores eval runs in Postgres. It imports the same Zod contracts as the app. Two things can invoke it: `scripts/eval.ts` (the CLI) and, as of 2026-09-17, `POST /api/eval/run` (an authenticated route).

**Why the route was added:** running an eval meant leaving the app for a terminal, which is a worse experience for casual/portfolio use than a "Run eval" button belongs to. The original objection (below) was about a *public, unauthenticated* trigger specifically, not about HTTP-triggered evals in general — gating it behind the same `EVAL_TOKEN` the CLI already needs removes that objection while keeping the convenience.

**The Vercel fix (2026-09-18): client-driven chunked runs, not a background task.** The original version fired the run as an un-awaited background task and returned `202` immediately — that only keeps executing on a process that stays alive after the response (`next dev`, a self-hosted `next start`), not guaranteed on Vercel's serverless functions. Now every `POST /api/eval/run` call is a bounded, *awaited* chunk (`lib/eval/runner.ts`'s `runEvalFixture` takes a `deadlineMs` and stops before starting a case that would run past it) — in practice about one case × repeat per call, comfortably inside `maxDuration`. The response reports `status: "in_progress" | "completed"` plus `cases_done`/`cases_total`/`retry_after_ms`; `EvalRunForm` (the same browser tab that started the run) keeps calling back with `resume_eval_run_id` until it sees `"completed"`. rpm pacing survives across those separate serverless invocations because the pacer's clock is seeded from `getLastResultTimestamp` (the most recent `eval_results.created_at` for that run) instead of restarting at zero each call — without that seed, a fresh invocation would treat itself as the very first call ever and fire unthrottled regardless of rpm.

**Why this option over the other two considered (queue, or `waitUntil`):**
- *An external queue (QStash/Inngest/Vercel Queue)* — most robust (survives the browser closing entirely), but adds a paid third-party dependency and a new adapter for a portfolio-scale feature. Cuts against this repo's standing "question infra before adding it" preference (D14 rejected a vector DB on the same grounds).
- *`@vercel/functions`' `waitUntil` alone* — doesn't actually solve it. `waitUntil` extends a function past its response, but the function is still capped by its own `maxDuration` (up to ~800s even on paid tiers with Fluid Compute). A 20-case run at `rpm=1` takes ~20 minutes — any rpm low enough to matter blows past that regardless of `waitUntil`.

**Tradeoff accepted:** the run only advances while its initiating browser tab is open and polling — closing it stops the run (completed cases stay recorded; resuming from a closed tab needs the CLI's `--resume`, not this route, since the form has no way to resume an abandoned run by id). Acceptable for a "run it, watch it finish" portfolio feature; would need revisiting (probably the queue option) if this ever needed to survive the browser closing.

**Why (original, still holds for the CLI path):**
- The PRD requires the harness to detect quality drops. Deterministic checks alone can't (structured output keeps schema validity near 100%, retries hide pass-rate drops, bland names pass every rule), so an LLM judge is required.
- One language: both the CLI and the route reuse `lib/contracts` types/schemas and the same `lib/eval` logic, so they can't drift from each other or from the app.
- It evolves an existing prototype (`prior-eval-prototype`: good vs. regressed prompt, one run, average score) into a rigorous harness (repeats, confidence intervals, stored baselines).
- Calling the app over HTTP tests the running system as a black box and measures real latency — true whether the caller is the CLI or the new route, since both still hit `/api/generate` over the network rather than calling `runGeneration` directly.

**Rejected:**
- *Python + DeepEval* — a second language and duplicated response models (Pydantic) for a library whose main value here was its name.
- *An unauthenticated `POST /api/eval/run`* — still rejected: a single request running dozens of generations exceeds serverless duration limits, and a trigger open to any visitor lets anyone burn the project's daily quota. The 2026-09-17 route is authenticated the same way eval-sourced generations already are, which is the difference that makes it acceptable.

---

### D4 — No eval scoring on live user runs
**Decision:** Live runs record guardrail outcomes, retries, latency, and tokens. Judge scores exist only in the offline harness.

**Why:** A judge call on every generation adds latency and consumes free-tier quota, and live runs have no expected outcome to score against. Regression detection needs comparable scores on a fixed fixture.

**Rejected:** *Async judging after the response* — still spends quota per generation and scores an uncontrolled population that can't be compared across versions.

---

### D5 — The public demo is open, bounded by quota
**Revised 2026-09-15:** was bounded by a provider spend cap. Changed because the free tier has no spend, only quota.

**Decision:** No login or access code. Per-IP limit (default 10 generations/hour), a rolling 24-hour global cap sized below the project's requests-per-day quota, and no public eval trigger. When Gemini reports the daily quota is exhausted, the UI shows a "demo quota reached" notice and the gallery keeps working.

**Why:** The link goes into job applications; any friction lowers the chance a reviewer tries it. A project without billing makes openness safe on cost. The global cap keeps one visitor from exhausting the day's quota for everyone else.

**Rejected:**
- *Access code* — reviewers skimming an application often won't hunt for a code.
- *Per-IP limit only* — defeated by IP rotation; the global cap is the backstop.

---

### D6 — Generations form a public shared gallery
**Revised 2026-09-15:** semantic search removed (D14); the gallery is filtered by category.

**Revised 2026-09-20:** corrected to match the shipped copy — the Generate tab's disclosure (`components/generate/GenerateForm.tsx`) only ever said IP hashing and public-gallery visibility; it never named Gemini or Google. This decision previously claimed it also disclosed the idea being "sent to Gemini's free tier (where Google may use them to improve its products)," which was never actually shipped — doc drift, not a regression from the Qwen switch (D2, D26). Provider-agnostic wording turned out to be the right call in hindsight, now that the active provider varies by `LLM_PROVIDER`.

**Decision:** All successful user generations appear in the gallery. The Generate tab states upfront that the idea is stored and may appear publicly, and that the IP address is hashed and used only for rate limiting — not which LLM provider processes it. Offensive items are hidden manually with a `hidden` flag. Eval-generated content never appears.

**Why:** A first-time visitor — often a reviewer — sees a populated gallery instead of an empty page.

**Rejected:** *Per-session (anonymous cookie) visibility* — every new visitor starts empty, and "my brands" vanish when cookies clear.

---

### D7 — Hard failures show reasons, not content
**Decision:** A rejected run shows which step failed and plain-language rule messages, with a "Try again" button. No generated content from a failing run is shown.

**Why:** It keeps the promise that users never see policy-violating output. Visible rule names demonstrate the guardrails working. The rejection rate is measured (PRD M2), so rejections can't hide quality problems.

**Rejected:**
- *Show the best attempt with a warning* — a banned word or health claim "with a warning" has still been shown.
- *Auto-regenerate until it passes* — multiplies latency and quota use, and hides the failure rate.

---

### D8 — The naming agent returns three candidates
**Decision:** Naming returns 3 candidates ordered by preference. The first one passing all name rules is selected automatically, and the other passing names are shown. (Stage 5: picking an alternate regenerates the rest of the copy around it.)

**Why:** Founders want options. A candidate that fails a rule is dropped instead of forcing a retry, which saves quota and latency.

**Rejected:**
- *One name* — any name failure forces a retry, and the user gets no choice.
- *Pause the chain so the user picks first* — a stateful two-request flow before any result.
- *Accept a free-text name on regenerate* — a new unvalidated input path.

---

### D9 — The feasibility lookup runs before generation
**Decision:** Look up the feasibility option first, pass material, cost, MOQ and lead time into the agents, and enforce a `copy.material` guardrail. The UI also shows the cash needed for a first production run (MOQ × per-unit cost range).

**Why:** The product's core problem is bridging creative output with physical constraints. With the lookup after generation, the copy can contradict the estimate and nothing notices. The first-run cash figure turns an abstract MOQ into the number a first-time founder actually has to find.

**Rejected:**
- *Lookup after generation* — the estimate constrains nothing.
- *LLM-generated feasibility numbers* — invented numbers presented as estimates.

---

### D10 — Brands and products are separate; the tagline agent emits tone notes
**Decision:** `brands` (name, tone_notes) has many `products`. The tagline/description agent emits `tone_notes` for a new brand; Stage 5 follow-up products read them.

**Why:** Adding a second product under the same brand is a planned user story, and a single row holding brand and copy can't represent it. Emitting tone notes inside an existing call costs no extra request.

**Rejected:**
- *Separate tone-extraction agent* — one more call per brand against quota and latency.
- *Find the brand by name* — names aren't unique.

---

### D11 — Validate per agent; one quality retry with feedback
**Revised 2026-09-15:** timeouts and provider errors are no longer quality attempts; they belong to the transport layer (D21).

**Decision:** Each agent's output is checked immediately: valid JSON, matching shape, not safety-blocked, passing its guardrail rules. A content failure gets exactly one retry, and the retry prompt lists the failed rules. A second content failure rejects the run. Transport failures (after D21's retries) end the run with `error`, not a quality retry.

**Why:**
- *Per agent:* validating only at the end of the chain throws away downstream calls when an upstream step fails.
- *Feedback:* a blind retry often repeats the same violation.
- *Separate from transport:* a 429 says nothing about content quality; retrying it with "feedback" wastes a call and muddies the retry metrics.

**Rejected:**
- *More quality retries* — latency and quota, and it masks bad prompts.
- *One shared retry budget for everything* — a throttled request would consume the chance to fix a real content failure.

---

### D12 — Model routing is decided from eval data
**Revised 2026-09-15:** cost is $0 on the free tier, so the tie-breakers are latency and per-model quota.

**Decision:** Stage 1 runs every step on `strong`. In Stage 5, the harness runs each step on `cheap`; a step moves down only if no quality metric is flagged as a regression, and the move is justified by measured latency or quota headroom.

**Why:** Output length isn't difficulty — the name is short but the most creative output. Measuring gives an evidence-backed story instead of an up-front rule. Starting on `strong` establishes the quality baseline first.

**Rejected:** *Static rule by intuition* (untested); *dynamic/ML router* (no data, overkill for three steps).

---

### D13 — Progress streams as NDJSON over a POST request
**Decision:** `/api/generate` streams newline-delimited JSON events when the client sends `Accept: application/x-ndjson`; otherwise it returns one JSON body.

**Why:** Three sequential LLM calls (more with retries or throttling) take several seconds. Per-step progress makes the wait legible and shows the agent chain.

**Rejected:**
- *Server-Sent Events via `EventSource`* — GET-only, so the idea would go in a query string or a two-step flow.
- *WebSockets* — Vercel functions don't act as long-lived WebSocket servers.
- *Polling* — needs a job store and adds latency.

---

### D14 — No semantic search and no vector database
**Revised 2026-09-15:** replaces "exact vector search, no ANN index".

**Decision:** The gallery is browsed by category. No embeddings, no pgvector, no vector DB.

**Why:**
- Search isn't part of the core idea → brand → manufacturing flow the project demonstrates.
- The corpus is hundreds of rows, easily browsed with a filter.
- Embeddings would consume free-tier quota on every generation and every query.
- A search feature would need its own query fixture just to justify it.

**Rejected:**
- *Dedicated vector database* — new infrastructure for hundreds of rows.
- *pgvector now* — no demonstrated need. If search returns later, it starts as Postgres full-text search and moves to pgvector in the same database only if a fixed query set shows full-text search falling short.

---

### D15 — Server-only database access; RLS on with zero policies
**Revised 2026-09-15:** access is via `DATABASE_URL` and `pg` (D20), not the Supabase service-role key.

**Revised 2026-09-20:** production host changed from Supabase to Neon (D20). Neon has no equivalent auto-exposed public Data API, so the specific threat this decision was originally written against no longer applies. RLS stays enabled with no policies anyway, now as plain defense-in-depth — it costs nothing and means any future BaaS-style layer with its own row access (added to this project or copied into another) is closed by default rather than open by default.

**Decision:** Only route handlers and local scripts touch Postgres. Every table has RLS enabled and no policies.

**Why:** All reads pass through route handlers that apply filters (hidden items, eval content, metadata-only run views). RLS with no policies means any connection that isn't the app's own `pg` pool reads and writes nothing, regardless of how it got a connection.

**Rejected:** *RLS off* — no defense-in-depth if a connection string or future access path other than the app's own `pg` pool is ever introduced.

---

### D16 — Rate limits are counted in Postgres
**Revised 2026-09-20:** `GLOBAL_DAILY_GENERATION_CAP` sized for real (was a 50/day placeholder) — `1000 ÷ 6 = 166`, against Groq's qwen/qwen3.8-27b free tier (1,000 RPD, confirmed at console.groq.com/docs/rate-limits the same day D2/D26 made it the production provider). `RATE_LIMIT_GENERATE_PER_HOUR` (10/IP/hour) wasn't touched — it's an abuse-prevention throttle on a single visitor, not derived from provider quota math, and 10/hour/IP is already far under the ~300/hour system-wide ceiling Groq's 30 RPM implies at 6 calls/run worst case.

**Decision:** Count recent `runs` rows by hashed IP and globally with an indexed query, using the app server's clock for the window (as `booking-app/lib/rateLimit.ts` does). Requests with no identifiable IP share one bucket.

**Why:** Postgres is already there, the rows being counted are written anyway, and demo traffic makes an indexed count cheap. A shared bucket for unknown IPs fails closed.

**Rejected:**
- *In-memory counters* — per instance, reset on cold starts.
- *Redis/Upstash* — another service and secret for a demo.

**Accepted trade-off:** concurrent requests can slightly overshoot a limit; the global cap and the project's own quota are the backstop.

---

### D17 — Zod describes shape; guardrail rules describe constraints; prompt version = content hash
**Revised 2026-09-15:** length and count constraints moved out of the Zod schemas into guardrail rules.

**Decision:**
- LLM output schemas in Zod describe shape only (fields, types, required). They are converted to JSON Schema for Gemini's structured output and re-validated on every response.
- Word counts, item counts, and all content constraints are guardrail rules with ids.
- A prompt's version is the first 12 hex chars of `sha256(system template + user template + JSON schema)`.

**Why:**
- Gemini's structured output supports only a subset of JSON Schema (e.g. no string length limits), and its docs say to validate values in the application anyway.
- One mechanism for constraints: every violation has a rule id and a message, which feeds the retry prompt, the UI, and the run log.
- Content hashes change whenever a prompt or schema changes and only then; manual tags get forgotten.

**Rejected:**
- *Constraints in both Zod and rules* — two sources of truth, and Zod failures would produce messages that don't match rule ids.
- *Git SHA as prompt version* — changes on unrelated commits.

---

### D18 — Eval deltas use paired bootstrap confidence intervals
**Decision:** Compare each metric to the baseline, paired by fixture case, with a 95% bootstrap CI over cases. A change is flagged when the CI excludes 0 **and** the delta meets a minimum effect size.

**Why:** Generation and judging are nondeterministic, n is ~20 cases, and difficulty varies far more between cases than between versions. Pairing removes between-case variance; the bootstrap assumes nothing about bounded 0–1 scores; the minimum effect ignores trivial changes.

**Rejected:** *Raw difference of means* (can't tell noise from change — what the prototype harness did); *unpaired t-test* (ignores pairing, shaky normality at n=20).

---

### D19 — A guardrail rejection is HTTP 200 with `status: "rejected"`
**Decision:** Well-formed requests whose generation is rejected by guardrails return 200 with `status: "rejected"`. 4xx is for caller mistakes, 5xx for system failures.

**Why:** Rejection is an outcome of a valid request, not an error. With streaming, the status line is sent before the outcome is known anyway.

**Rejected:** *422 for rejections* — can't be sent once a stream has started, and conflates bad input with an output that failed a rule.

---

### D20 — `pg` (node-postgres) against plain Postgres
**Added 2026-09-15.**

**Revised 2026-09-20:** production host changed from Supabase to Neon — same shape (pooled connection string for the app, direct/unpooled one for migrations), no code changes. This app never used any Supabase-specific feature (auth, storage, realtime, the Data API — see D15), so Supabase was an unused feature surface. Two concrete reasons to move: Neon's free-tier compute autosuspends and autoresumes transparently on the next connection, while Supabase's free-tier *project* pauses entirely after 7 days of inactivity and needs a manual dashboard restore — a bad failure mode for a portfolio demo opened sporadically, not continuously; and Vercel's own Postgres offering is Neon under the hood, so `DATABASE_URL` wiring from the Vercel dashboard is more first-party.

**Decision:** The app talks to Postgres with `pg` and parameterized SQL. Locally: one Docker `postgres:16-alpine` container on port 5434. Production: Neon-hosted Postgres through its connection pooler (migrations over a direct connection). Migrations are ordered SQL files applied by a small script.

**Why:**
- Real transactions in TypeScript: a run's steps, brand, product, and final status are written atomically without moving logic into database functions.
- One small container locally (the Supabase CLI stack is several GB on a nearly full disk).
- The same pattern as `booking-app`, so the codebase reads consistently across projects.

**Rejected:**
- *supabase-js* — HTTP API without multi-statement transactions; atomic writes would need plpgsql RPC functions.
- *Supabase CLI local stack* — many containers for features this app doesn't use.
- *Prisma* — the schema is jsonb- and array-heavy and the queries are few; a generated client adds more than it saves.
- *A migration library (node-pg-migrate, dbmate)* — a dependency for ordering and recording a handful of plain SQL files.

---

### D21 — Two retry layers: transport and quality
**Added 2026-09-15.**

**Decision:**
- **Transport layer** (Gemini adapter): retries HTTP 408/429/500/502/503/504 and per-call timeouts with exponential backoff and full jitter, honors the server's suggested retry delay, and never starts a retry that couldn't finish before the run deadline. Exhausted daily quota is not retried. The SDK's built-in retry is disabled.
- **Quality layer** (service, D11): one retry for content failures, with feedback.
- Every transport retry is recorded on its step, and runs that were throttled are reported separately in latency metrics.

**Why:** On the free tier, throttling is normal, not exceptional. Keeping the layers separate keeps each simple and makes both measurable.

**Rejected:**
- *SDK default retry* — up to 5 attempts with delays up to 60 s, invisible to the run log and unaware of the deadline.
- *No transport retry* — ordinary per-minute throttling would reject otherwise-good runs.
- *Retrying daily-quota exhaustion* — it won't clear until the quota resets; the honest answer is a clear notice.

---

### D22 — Moderation uses Gemini's safety feedback, not a separate call
**Added 2026-09-15.**

**Decision:** If Gemini blocks the prompt (`promptFeedback.blockReason`), the run is rejected with `input.safety`. If a response is stopped for safety, the attempt fails with `output.safety` and gets the quality retry. A banned-word check on the idea runs before any call.

**Why:** A dedicated moderation request per run would spend quota and latency on something the generation call already reports.

**Rejected:** *A separate moderation/classification call* — one extra request per run on a quota budget.

---

### D23 — Layered code with lint-enforced boundaries
**Added 2026-09-15.**

**Decision:**
| Layer | Path | Rule |
|---|---|---|
| Contracts | `lib/contracts` | Zod request/response/event types shared by server and browser |
| Domain | `lib/domain` | Pure: no I/O, no framework, no database or SDK imports |
| Services | `lib/services` | Orchestration against small ports (`LlmClient`, `GenerationStore`, `Clock`) |
| Adapters | `lib/adapters` | Gemini, Postgres, env |
| Delivery | `app/`, `components/`, `lib/client` | Route handlers map HTTP to services; UI imports contracts only |

ESLint `no-restricted-imports` enforces the domain, contracts, and services rules. Agents are data (`{ step, schema, prompt, evaluate }`) run by one generic step runner.

**Why:** The guardrails, name selection, and result building — the logic worth trusting — are testable without mocks. The only interfaces are at real seams (the LLM, the store, the clock), so tests swap in fakes where it matters.

**Rejected:**
- *Everything in route handlers* — untestable without HTTP and a database.
- *Repository interface per table, DI container, agent class hierarchy* — ceremony for a codebase this size; it makes the code harder to read, not easier.

---

### D24 — No LangChain
**Added 2026-09-15.**

**Decision:** Agents call the Gemini SDK through the `LlmClient` port. No orchestration framework.

**Why:** The chain is three sequential structured calls with custom validation and retry semantics (D11, D21). A framework would wrap those in its own abstractions without removing any of the code.

**Rejected:** *LangChain for one agent step* — added only as a résumé keyword, which conflicts with the clean-code goal.

---

### D25 — Resume creates a new run row, linked via `resumed_from_run_id`
**Added 2026-09-17.**

**Decision:** Retrying a run that failed after at least one step succeeded (e.g. `naming` passed, `tagline_description` hit a transient `provider_error`) starts a **new** run with a new `run_id`, carrying a nullable `runs.resumed_from_run_id` pointer to the failed run. The already-succeeded steps' accepted output is re-validated against the live agent's `evaluate()` and reused; only the remaining steps make a fresh LLM call.

**Why:**
- Keeps the existing create-once/finish-once `runs` row lifecycle (D-implicit in §4) untouched — no run is ever reopened or mutated after `finishRun`.
- Re-validating stored `raw_output` through the same `evaluate()` a live pipeline uses means a resumed step is judged identically to a live one, not trusted blindly.
- Avoids repeating LLM calls (and burning Gemini free-tier quota, D2) for steps that already produced accepted output.

**Rejected:**
- *Continue the same run row* — would mean reopening a `finished_at` row and re-deriving its status, contradicting the run lifecycle's single-writer, finish-once model and complicating rate-limit counting (D16 counts rows, not attempts).
- *Client resubmits the prior accepted output directly* — would let a client claim any content as "already accepted" without server-side re-validation; re-running `evaluate()` against the stored `raw_output` server-side is the only way to keep guardrail enforcement authoritative.

---

### D26 — A Qwen (via Groq) adapter exists alongside Gemini, selectable by env var in any environment
**Added 2026-09-17.**

**Revised 2026-09-20:** dropped the `NODE_ENV !== "production"` gate — `LLM_PROVIDER=qwen` now selects Qwen in a deployed build too, and the live demo currently runs on it (see D2). Originally scoped local-only specifically to keep the deployed pitch on Gemini regardless of a stray env var; that constraint was intentionally lifted, not accidentally dropped.

**Decision:** `lib/adapters/qwen/client.ts` implements `LlmClient` against Groq's OpenAI-compatible API (`qwen/qwen3.8-27b`), selected whenever `LLM_PROVIDER=qwen` is set (`lib/adapters/createLlmClient.ts`). Originally added to exercise the app repeatedly (e.g. live-testing D25's resume flow) without spending Gemini's ~20-100/day free-tier quota; Groq's free tier gives 1,000 requests/day for this model — since 2026-09-20 that headroom is also why it's the production default.

**Why:** Gemini's daily quota is small enough that a single testing session can exhaust it before finishing (observed repeatedly the week of 2026-09-15, and again against the deployed demo on 2026-09-20). `LlmClient` was already a port (D23), so adding a second adapter is additive.

**Known gap, accepted — now a live production trade-off, not just a testing caveat:** Groq/Qwen exposes no equivalent of Gemini's safety feedback (D22) — the Qwen adapter never produces `prompt_blocked`/`response_blocked`. While Qwen is the active provider (currently: production), that moderation layer doesn't run for real traffic, not just for test passes — the app's own banned-word/regulated-claims/famous-brand checks (D17, provider-independent) are what's actually protecting a public demo against that class of input.

**Rejected:**
- *Self-hosted Qwen via Ollama* — the dev machine has no GPU and only ~14GB free disk; CPU-only inference on a model large enough for reliable JSON-schema output would likely exceed the app's 10s per-call/25s run deadlines.
- *OpenRouter's free Qwen models* — free tier is more restrictive (50 req/day) than what we're trying to escape, and has documented unreliable structured-output support for Qwen specifically.

---

### D27 — Eval traffic is admitted by a shared-secret header, not a separate endpoint, and bypasses rate limits by construction
**Added 2026-09-17.**

**Decision:** `POST /api/generate` accepts `X-Eval-Token` (must equal `EVAL_TOKEN`, constant-time compared), `X-Eval-Run-Id` (must reference an existing `eval_runs` row), and an optional `X-Eval-Prompt-Variant` (only `naming=degraded` exists, for the D18 sensitivity proof). A valid token admits the request as `source: "eval"` and skips `checkRateLimit` (D16) entirely — `runs`/`countRuns` already filter `source = user` for the per-IP and global caps, so this just makes an existing exemption explicit rather than leaving it as an accidental side effect of how those queries happen to be written. `EVAL_TOKEN` unset (the deployed public demo's default, Stage 3) means the target accepts no eval traffic at all, full stop.

**Why:**
- No separate `POST /api/eval/run` (already rejected in D3) means the harness has to go through the same admission path a browser uses — a header-based auth scheme is the minimal addition that lets it identify itself without a second endpoint.
- Bypassing rate limits has to be intentional and gated, not implicit: an eval run of 20 cases × 3 repeats is 60+ generations, which would blow through the default 10/hour, 50/day caps sized for real public traffic (D16) in minutes. The alternative — raising those caps to accommodate eval traffic — would just as directly undermine the reason they exist (bounding the shared free-tier quota, PRD M6).
- The sensitivity proof (PRD M4) needs a way to run the *exact* live pipeline with one prompt swapped, not a hand-maintained parallel copy of `runGeneration` that could drift from the real one. Threading an optional `namingAgentOverride` through `RunGenerationInput` (only ever set from this one header, never reachable from the live UI) keeps the degraded variant honestly running through the same guardrails, retry logic, and persistence as a real request.

**Rejected:**
- *A static allowlist of IPs/hosts instead of a token* — doesn't work against a deployed target the CLI reaches over the public internet, and is harder to rotate than an env var.
- *A JWT or signed request instead of a shared secret* — this is a single first-party CLI talking to a target the same operator controls; a shared secret is the right amount of mechanism, not less secure for this threat model (a leaked `EVAL_TOKEN` lets someone burn quota, not access user data).
- *Giving the CLI its own service-role DB credentials and writing runs directly, skipping HTTP* — would stop testing the deployed system as a black box (D3's whole point) and would need the CLI to reimplement admission/guardrail logic it should be verifying, not bypassing.

---

## Open items — need a human
1. **Quota numbers.** Read the project's requests-per-minute and requests-per-day for both models on the AI Studio rate-limit page, then set `GLOBAL_DAILY_GENERATION_CAP` ≤ RPD ÷ 6 (worst case: 3 steps × 2 attempts).
2. **Feasibility numbers.** Seed values are labelled illustrative but need a plausibility pass.
3. **Word lists.** Banned words, regulated claims, famous brands, and material vocabulary are starter lists and need curating.
4. **Visual design.** No mocks exist; the docs specify UI states and content, not layout or styling.
