# Technical Requirements Document
## Project: BrandForge (working name)

> **Revision 3 — 2026-09-15.** Gemini free tier, `pg` + plain Postgres, no vector search, TypeScript eval, layered code. Rationale and rejected alternatives for every **[Dn]** are in `DECISIONS.md`.

### 1. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind 4 |
| Backend | Next.js Route Handlers (Node.js runtime), TypeScript |
| Database | Postgres 16 via `pg`. Local: Docker `postgres:16-alpine` on port 5434. Production: Supabase-hosted Postgres through its pooler [D20] |
| LLM | Gemini API, free tier, via `@google/genai`; `strong` / `cheap` tiers from env [D2] |
| Schemas | Zod 4 — API contracts and LLM output shapes [D17] |
| Evaluation | TypeScript CLI in this repo (Stage 2) [D3] |
| Tests / CI | Vitest (`unit` and `integration` projects), GitHub Actions |
| Deploy | Vercel + Supabase Postgres (Stage 3) |

Model defaults: `MODEL_STRONG=gemini-3.8-flash`, `MODEL_CHEAP=gemini-3.5-flash-lite`. `scripts/check-models.ts` confirms both are available to the configured key. Model IDs are recorded on every step.

### 2. Architecture

**Code layers** [D23]

| Layer | Path | May import | Contains |
|---|---|---|---|
| Contracts | `lib/contracts` | `zod` | Request, response, and stream-event types shared by server and browser |
| Domain | `lib/domain` | contracts, `config`, `zod` | Pure logic: agent specs, prompt templates, guardrails, name selection, feasibility math, result builder |
| Services | `lib/services` | domain, contracts, `config` | Orchestration against ports: `LlmClient`, `GenerationStore`, `Clock` |
| Adapters | `lib/adapters` | anything | Gemini client + transport retry, Postgres store and read queries, env |
| Delivery | `app/`, `components/`, `lib/client` | route handlers: services + adapters; UI: contracts | HTTP mapping, React components, stream reader |

ESLint `no-restricted-imports` blocks `pg`, `@google/genai`, `next`, `react`, adapters, and services from `lib/domain` and `lib/contracts`, and blocks `pg`, `@google/genai`, `next`, and adapters from `lib/services`.

**Request flow — `POST /api/generate`**

```
Route handler
 0. Parse body (Zod) · resolve category + option · rate limits        → 400 / 429, not persisted
 1. startRun (status = running) · input guardrails (banned words)
 2. Feasibility option → trusted prompt facts
 3. naming               ┐  runStep, for each agent spec:
 4. tagline_description  │    LLM call (transport retries inside the adapter)
 5. packaging            ┘    → JSON shape → rules → accept | one quality retry with feedback | reject
 6. finishRun: run_steps + brand + product + run update, one transaction
 7. `result` event (content only when status = succeeded)
```

A Gemini prompt block during any step rejects the run with `input.safety`. Exhausted daily quota or exhausted transport retries end the run with `error`.

### 3. Categories & Feasibility Data
- 10 categories: `canned_beverage`, `supplement_capsules`, `skincare_serum`, `t_shirt`, `water_bottle`, `candle`, `coffee_beans`, `snack_bar`, `pet_treats`, `tote_bag`.
- Each has 2–3 material options, exactly one default, seeded idempotently by `db/seed.sql`.
- Beverages, supplements, skincare, and snacks are included on purpose: they tempt the model into health claims and so exercise `copy.regulated_claim`.
- All numbers are illustrative. Every option has an `assumptions` note, shown next to an "Illustrative estimate" label.
- First-run cash = `moq × cost_low` … `moq × cost_high`, computed in `lib/domain/feasibility.ts`, not stored.
- An integration test asserts: exactly one default per category, non-empty `keywords` and `material_terms`, `cost_low ≤ cost_high`, `lead_time_days_low ≤ lead_time_days_high`, `moq > 0`.

### 4. Data Model

Conventions: all tables in `public` with **RLS enabled and no policies** [D15]; `uuid default gen_random_uuid()` ids; `created_at timestamptz not null default now()`.

Stage 1 tables and Stage 2's `eval_runs`/`eval_results`/`runs.eval_run_id` are below (each arrived in its own migration). Stage 5 adds `runs.parent_run_id` and `runs.input_brand_id`, not yet built.

**categories**
| column | type | notes |
|---|---|---|
| slug | text, pk | e.g. `water_bottle` |
| display_name | text not null | |
| keywords | text[] not null | words that count as mentioning the category, incl. plurals/synonyms |
| sort_order | smallint not null | dropdown order |

**feasibility_options**
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| category | text, fk → categories.slug | |
| material | text not null | display label |
| material_terms | text[] not null | material-vocabulary terms this option makes true |
| cost_low, cost_high | numeric(10,2) not null | per unit at `moq`; check low ≤ high |
| currency | char(3) not null default 'USD' | |
| moq | int not null | check > 0 |
| lead_time_days_low, lead_time_days_high | int not null | check low ≤ high |
| assumptions | text not null | |
| is_default | bool not null default false | unique partial index on `(category) where is_default` |

Unique `(category, material)`.

**brands**
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| name | text not null | not unique |
| tone_notes | jsonb not null | shape in §5 |
| source | text not null | check in (`user`, `seed`, `eval`) |
| hidden | bool not null default false | |
| created_at | timestamptz | |

**products**
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| brand_id | uuid, fk → brands.id on delete cascade | |
| run_id | uuid, fk → runs.id, unique, nullable | null only for seed products |
| category | text, fk → categories.slug | |
| feasibility_option_id | uuid, fk → feasibility_options.id | |
| feasibility_snapshot | jsonb not null | option as it was at generation time |
| idea, tagline, description | text not null | |
| packaging | jsonb not null | `{ headline, body, callouts[] }` |
| source | text not null | check in (`user`, `seed`, `eval`) |
| hidden | bool not null default false | |
| created_at | timestamptz | |

Index `(source, hidden, category, created_at desc)`.

**runs** — one row per admitted `/api/generate` request
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| source | text not null | check in (`user`, `eval`) |
| idea | text not null | |
| category | text, fk | |
| feasibility_option_id | uuid, fk | |
| status | text not null | check in (`running`, `succeeded`, `rejected`, `error`) |
| failure | jsonb, nullable | `{ step, violations: [{ rule, message }] }` or `{ step, error, message }` |
| resumed_from_run_id | uuid, fk → runs.id, nullable | set when this run resumes a prior run's already-succeeded steps [D25] |
| name_candidates | jsonb, nullable | `[{ name, rationale, passed, violations }]` |
| prompt_versions | jsonb not null | `{ step: hash }` |
| input_tokens, output_tokens, thinking_tokens | int not null default 0 | sums across steps |
| quality_retries, transport_retries | int not null default 0 | |
| latency_ms, first_event_ms | int, nullable | server-measured |
| client_ip_hash | text not null | `sha256(IP_HASH_SALT + ip)`; raw IP never stored |
| created_at, finished_at | timestamptz | `finished_at` nullable |

Indexes: `(client_ip_hash, created_at)`, `(source, created_at)`.

Lifecycle: inserted as `running` when admitted, so in-flight requests count toward rate limits and crashes stay visible; finalized in `finishRun`. Views report `running` rows older than 60 s as `error`.

**run_steps** — one row per LLM attempt
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| run_id | uuid, fk → runs.id on delete cascade | |
| step | text not null | `naming`, `tagline_description`, `packaging` |
| attempt | smallint not null | 1 or 2 (quality attempts) |
| model, prompt_version | text not null | |
| input_tokens, output_tokens, thinking_tokens | int not null default 0 | |
| transport_retries | int not null default 0 | |
| latency_ms | int not null | including transport retries |
| raw_output | jsonb, nullable | never exposed via API |
| violations | jsonb not null default '[]' | `[{ rule, message }]` |
| error | text, nullable | `timeout`, `provider_error`, `quota_exhausted`, `aborted` |
| created_at | timestamptz | |

**schema_migrations** — `name text pk, applied_at timestamptz`; written by the migration script.

**eval_runs** — one row per `npm run eval -- generate` invocation (Stage 2, §9)
| column | type | notes |
|---|---|---|
| id | uuid, pk | this run's `X-Eval-Run-Id` |
| label | text not null | e.g. `naming-degraded-2026-09-20` |
| git_sha | text not null | `git rev-parse HEAD` at invocation time |
| target | text not null | the `--target` URL |
| fixture_version | text not null | `lib/eval/fixture.ts`'s `FIXTURE_VERSION` |
| prompt_versions | jsonb not null | `{ step: hash }`, from the first case's `GenerateResult.meta` |
| models | jsonb not null | `{ step: model }` plus `judge`, from the same |
| repeats | int not null | check > 0 |
| is_baseline | bool not null default false | set by `--set-baseline`; more than one row may hold it over time, `compare` uses the latest |
| aggregate | jsonb, nullable | this run's own metrics (§9 "Metrics"), null until every case × repeat completes |
| comparison | jsonb, nullable | this run vs. the baseline at compare time (§9 "Comparison"), null until `compare` runs |
| created_at, finished_at | timestamptz | `finished_at` nullable — a resumable run spanning days is not yet finished |

Index `(is_baseline, created_at desc)`.

**eval_results** — one row per fixture case × repeat, written as it completes (resumability)
| column | type | notes |
|---|---|---|
| id | uuid, pk | |
| eval_run_id | uuid, fk → eval_runs.id on delete cascade | |
| case_id | text not null | fixture case id |
| repeat | smallint not null | 1-based |
| run_id | uuid, fk → runs.id, nullable | null when admission itself failed (rate limit, bad token) before a run row could exist |
| expected_outcome | text not null | check in (`pass`, `reject`, `safe`) — fixture's expectation |
| actual_outcome | text not null | check in (`pass`, `reject`, `error`, `admission_error`) |
| outcome_match | bool not null | `actual_outcome` satisfies `expected_outcome` (`safe` accepts either `reject` or a `pass` with relevance ≥ 0.5) |
| first_attempt_pass | bool, nullable | naming's first quality attempt passed with no retry; null on non-`pass` outcomes |
| quality_retries | int, nullable | from `GenerateResult.guardrails.quality_retries` |
| throttled | bool not null default false | this case × repeat waited on the harness's own RPM pacing, not app-side retry |
| latency_ms, first_event_ms | int, nullable | from `GenerateResult.meta`/the stream's first event |
| input_tokens, output_tokens, thinking_tokens | int not null default 0 | |
| relevance_score, distinctiveness_score | numeric(3,2), nullable | judge rubric, 0–1; null on non-`pass` outcomes (nothing to judge) |
| name_uniqueness | numeric(3,2), nullable | fraction of the 3 name candidates that are pairwise distinct; null on non-`pass` |
| judge_reason | text, nullable | judge's one-sentence rationale |
| created_at | timestamptz | |

Unique `(eval_run_id, case_id, repeat)` — `--resume` upserts on conflict, skipping a case × repeat that already has a row instead of re-spending quota on it.

`runs.eval_run_id` — nullable `uuid references eval_runs (id)`, set on every run the harness admits (via `X-Eval-Run-Id`), so eval-sourced `runs`/`products` rows can be found directly without joining `eval_results`.

### 5. Agent Chain

**Agent spec (data, not classes)** [D23]
```ts
interface AgentSpec<Input, Output, Accepted> {
  step: StepName;
  outputSchema: z.ZodType<Output>;          // shape only [D17]
  prompt: PromptTemplate;                    // { system, user } with {{placeholders}}
  toVariables(input: Input): Record<string, string>;
  evaluate(output: Output, input: Input): Evaluation<Accepted>;
}
type Evaluation<A> = { ok: true; accepted: A } | { ok: false; violations: Violation[] };
```
A generic `runStep` executes any spec: render prompt → `LlmClient.generateJson` → Zod parse → `evaluate` → accept, retry once with feedback, or reject.

**Ports**
```ts
interface LlmClient {
  generateJson(request: LlmRequest): Promise<LlmOutcome>;   // never throws for provider failures
}
type LlmOutcome =
  | { kind: "ok"; json: unknown; usage: TokenUsage; transportRetries: number; latencyMs: number }
  | { kind: "prompt_blocked"; transportRetries: number; latencyMs: number }
  | { kind: "response_blocked"; usage: TokenUsage; transportRetries: number; latencyMs: number }
  | { kind: "failed"; error: "timeout" | "provider_error" | "quota_exhausted" | "invalid_json" | "aborted";
      message: string; transportRetries: number; latencyMs: number };

interface GenerationStore {
  findOption(category: string, optionId?: string): Promise<FeasibilityOption | null>;
  countRuns(filter: { ipHash?: string; since: Date }): Promise<number>;
  startRun(run: NewRun): Promise<string>;
  finishRun(record: FinishedRun): Promise<void>;           // one transaction
}

interface Clock { now(): number }
```

**Prompt construction**
- The system template carries the role, rules, and trusted facts (category, material, cost, MOQ, lead time, brand name, tone notes).
- The user's idea goes only in the user message, inside `<idea>` tags, with an instruction to treat it as data.
- On a quality retry, the system prompt gains a "previous attempt failed these checks" list built from the violations.
- Requests use `responseMimeType: "application/json"` and `responseJsonSchema` from `z.toJSONSchema(outputSchema)`; the response is re-validated with Zod.

**Output shapes (no counts or lengths — those are rules)**
| Agent | Output |
|---|---|
| naming | `{ candidates: [{ name, rationale }] }` |
| tagline_description | `{ tagline, description, tone_notes: { voice: string[], audience, personality, avoid: string[] } }` |
| packaging | `{ headline, body, callouts: string[] }` |

**Inputs**
| Agent | Receives |
|---|---|
| naming | idea, category, feasibility option |
| tagline_description | above + selected brand name |
| packaging | above + tagline, description, tone_notes |

**Name selection** [D8]: the first candidate, in the model's order, that passes all candidate rules. Only passing candidates' names are returned to the client.

**Timeouts and retries**
| Setting | Value | Where |
|---|---|---|
| Per HTTP call timeout | 10 s | adapter, `AbortSignal` |
| Run deadline | 25 s | service; route exports `maxDuration = 30` |
| Transport retry statuses | 408, 429, 500, 502, 503, 504, plus call timeouts | adapter [D21] |
| Transport backoff | exponential from 500 ms, ×2, full jitter, max 8 s; server `retryDelay` honored when larger | adapter |
| Transport retry guard | no retry that can't start ≥ 2 s before the deadline | adapter |
| Daily quota exhausted | no retry → `quota_exhausted` | adapter |
| SDK built-in retry | disabled (`attempts: 1`) | adapter |
| Quality retries | 1 per step, content failures only | service [D11] |

The route passes `request.signal` into the run, so a client disconnect cancels in-flight calls and the run finishes as `error` / `aborted`. The stream always ends with a `result` or `error` event.

### 6. Model Routing [D12]
- Stage 1: every step uses `strong`, via `config/routing.ts` (step → tier; tier → env model id).
- Optional per-step thinking level lives in the same config, unset by default, and is set only if measured latency requires it.
- Stage 5: per-step strong vs. cheap experiment through the eval harness.

### 7. Guardrails

Rules live in `lib/domain/guardrails/`; word lists in `config/` as TypeScript modules (`bannedWords`, `regulatedClaims`, `famousBrands`, `materialVocabulary`).

**Normalization before matching:** NFKC, lowercase, strip diacritics, punctuation and hyphens become word boundaries. Single words match whole words; multi-word entries match as whole phrases.

| Rule id | Scope | Check |
|---|---|---|
| `request.idea_length` | request → 400 | idea is 10–300 chars after trim |
| `request.option` | request → 400 | category exists; option belongs to it |
| `input.banned_word` | input | idea has no banned words |
| `input.safety` | input | Gemini did not block the prompt [D22] |
| `output.safety` | every step | response not stopped for safety |
| `output.schema` | every step | valid JSON matching the shape |
| `output.nonempty` | every step | every string non-empty after trim |
| `output.placeholder` | every step | no `[...]`, `{...}`, `<...>`, "lorem ipsum", "brand name", "product name" |
| `output.banned_word` | every step | no banned words in any string |
| `name.count` | naming | exactly 3 candidates |
| `name.distinct` | naming | candidates differ case-insensitively |
| `name.shape` | naming, per candidate | 1–3 words, 2–24 chars |
| `name.not_category` | naming, per candidate | not made only of category keywords |
| `name.famous_brand` | naming, per candidate | doesn't equal or contain a famous-brand entry |
| `name.none_passed` | naming | at least one candidate passes the per-candidate rules |
| `tagline.length` | tagline_description | 3–10 words |
| `description.length` | tagline_description | 40–120 words |
| `description.category` | tagline_description | contains ≥ 1 category keyword |
| `tone.shape` | tagline_description | voice 3–5 items; audience ≤ 20 words; personality ≤ 30 words; avoid ≤ 5 items |
| `packaging.headline_length` | packaging | ≤ 8 words |
| `packaging.body_length` | packaging | 20–80 words |
| `packaging.callouts` | packaging | 2–4 callouts, each ≤ 6 words |
| `packaging.brand_name` | packaging | brand name appears in headline or body |
| `copy.regulated_claim` | tagline_description, packaging | no regulated-claim phrase |
| `copy.material` | tagline_description, packaging | a plain mention of a material term must be in the option's `material_terms`; a negated mention ("plastic-free", "no plastic", "without plastic", "free of plastic") must **not** name a term in `material_terms` |

**Invariants**
- Every attempt's violations are stored in `run_steps`; the final failure in `runs.failure`.
- Generated content reaches the client only when `status = succeeded`, enforced by one response builder with a unit test (PRD M1).

**Known limitations:** starter word lists need curation; negation detection is pattern-based; the famous-brand check is list-based (no trademark search); prompt injection is mitigated, not prevented; hate and harassment rely on Gemini's safety filters.

### 8. API (Route Handlers)

Every body is validated with Zod. Error body (same shape as `booking-app/lib/apiResponse.ts`): `{ error: code, message }`.

| code | HTTP | when |
|---|---|---|
| `invalid_input` | 400 | body fails the schema, or unknown category/option |
| `not_found` | 404 | unknown brand |
| `rate_limited` | 429 | per-IP limit; includes `retry_after_s` |
| `daily_cap_reached` | 429 | global rolling-24h cap |
| `internal` | 500 | unexpected failure before a stream starts |

Guardrail rejections return 200 with `status: "rejected"`. [D19]

**`POST /api/generate`**
```ts
// request
{ idea: string; category: string; feasibility_option_id?: string;   // option defaults to the category's default
  resume_from_run_id?: string }   // [D25] re-validates that run's succeeded steps instead of re-calling the LLM for them
```
With `Accept: application/x-ndjson`, the response streams events (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`). Otherwise it returns one JSON body equal to the `result` event, or the error body. [D13]
```ts
type GenerateEvent =
  | { type: "run_started"; run_id: string }
  | { type: "step_started"; step: StepName }
  | { type: "step_finished"; step: StepName; attempt: 1 | 2; passed: boolean }
  | { type: "result"; result: GenerateResult }
  | { type: "error"; run_id: string; step: StepName; code: "quota_exhausted" | "deadline_exceeded" | "provider_error" | "aborted" | "internal"; message: string };
  // `step` is the resumability signal [D25]: step !== "naming" means at least naming already succeeded and a client can offer "Resume from {step}"

type GenerateResult = {
  run_id: string;
  status: "succeeded" | "rejected";
  feasibility: { material; cost_low; cost_high; currency; moq; lead_time_days_low; lead_time_days_high;
                 assumptions; first_run_cost_low; first_run_cost_high };
  brand?: { id; name; tone_notes };                          // succeeded only
  product?: { id; tagline; description; packaging };         // succeeded only
  name_candidates?: { name: string; selected: boolean }[];   // succeeded only; passing candidates only
  guardrails: { quality_retries: number;
                failure?: { step: StepName | "input"; violations: { rule: string; message: string }[] } };
  meta: { models: Record<StepName, string>; prompt_versions: Record<StepName, string>;
          latency_ms: number; transport_retries: number;
          tokens: { input: number; output: number; thinking: number } };
};
```

**`GET /api/categories`** → categories with their options, plus computed first-run cash.

**`GET /api/products?category&limit&cursor`** → gallery: newest products with `source in (user, seed)`, product and brand not hidden. `limit ≤ 48`; opaque cursor over `(created_at, id)`.

**`GET /api/brands/:id`** → brand and its visible products.

**`GET /api/runs?limit&cursor`** → run metadata only: id, created_at, status, failure (step + rule ids), resumed_from_run_id, models, quality and transport retries, latency, tokens. Never `raw_output`, idea text of non-succeeded runs, or IP hashes.

**`POST /api/generate` eval headers (Stage 2)** — present only when the harness, not a browser, is calling:
| Header | Required with the others | Effect |
|---|---|---|
| `X-Eval-Token` | — | Must equal `EVAL_TOKEN` (§12). Missing header → ordinary `source: "user"` admission, unchanged. Present but wrong, or `EVAL_TOKEN` unset on this target → `401 invalid_eval_token`, no run created. |
| `X-Eval-Run-Id` | yes | The calling `eval_runs.id`. Must already exist (`404 unknown_eval_run` if not — the CLI always creates its `eval_runs` row before the first case). Stamped onto `runs.eval_run_id`. |
| `X-Eval-Prompt-Variant` | no | `step=variant`, e.g. `naming=degraded` (§9 sensitivity proof). Unknown step or variant name → `400 invalid_input`. Only `naming=degraded` exists today. |

A valid token admits the request as `source: "eval"` and **skips `checkRateLimit` entirely** — the harness's own RPM pacing (§9) is the only throttle, and `runs` queries for the app's per-IP/global caps already filter `source = user` (§10), so eval traffic was already invisible to them even before this bypass made it explicit. `GenerateResult`/the stream are otherwise identical to a user-sourced run — the harness reads `run_id`, `status`, `meta`, `name_candidates`, and `guardrails.failure` the same way a browser client would.

**`GET /api/eval/summary?label&limit`** → recent `eval_runs` (newest first, optionally filtered by `label`): `id, label, git_sha, created_at, finished_at, is_baseline, repeats, aggregate, comparison`. Never `eval_results` rows (that detail is for the CLI's own `compare` output, not the UI).

**`POST /api/eval/run`** (D3, added 2026-09-17) — same `X-Eval-Token` auth as eval-sourced `/api/generate` calls, no admission bypass needed since this route doesn't touch guardrails/rate limits itself.
```ts
// request
{ label?: string; repeats?: number;                 // default 1; label required unless resume_eval_run_id is set
  prompt_variant?: string; set_baseline?: boolean;   // e.g. "naming=degraded"; marks the run baseline once it finishes
  resume_eval_run_id?: string; rpm?: number }         // continues an existing eval run instead of starting a new one

// response, 202 — the run continues after this returns (see D3's Vercel caveat)
{ eval_run_id: string; status: "started" }
```
Poll `GET /api/eval/summary` for progress — `finished_at: null` is the same "in progress" signal the UI already shows for a CLI-started run.

### 9. Evaluation Harness (Stage 2)
- **CLI:** `npm run eval -- generate --target URL --label NAME [--repeats 3] [--set-baseline] [--prompt-variant naming=degraded] [--resume EVAL_RUN_ID]`, plus `compare`.
- **Quota-aware:** concurrency 1 by default, paced to a configured requests-per-minute; each case × repeat is written as it completes, so `--resume` continues across days.
- **Fixture:** 20 cases, versioned (14 normal covering every category; 6 adversarial: 2 prompt injections, banned-word bait, regulated-claim bait, material bait, a safety-blocked idea). Expected outcomes `pass`, `reject`, or `safe` (rejected, or succeeded with relevance ≥ 0.5).
- **Metrics:** outcome match, first-attempt pass, quality retries, throttled flag, client latency and first-event time, tokens; judge rubric scores (0–1) for relevance and distinctiveness; per-run name uniqueness.
- **Judge:** `JUDGE_MODEL` pinned and recorded, preferably a different model generation than the generator; rubric adapted from the `prior-eval-prototype` judge.
- **Comparison** [D18]: paired by case, 95% bootstrap CI (10,000 resamples), flagged when the CI excludes 0 and |delta| ≥ 0.05 (0–1 scores) or ≥ 10% (latency). Throttled runs are excluded from latency percentiles and counted separately.
- **Sensitivity proof:** a `degraded` naming variant ("Prefer simple, safe names using common prefixes like Eco, Green, or Pure.") must be flagged as a distinctiveness regression before any other result is trusted.
- **Storage:** `eval_runs` (label, git_sha, target, fixture version, prompt versions, models, repeats, is_baseline, aggregate, comparison) and `eval_results` (case, repeat, run_id, expected outcome, scores, judge reasons, latency).

### 10. Security & Public-Demo Protections
- **Database:** only route handlers and scripts connect, using a server-side `DATABASE_URL`. RLS enabled on every table with no policies; an integration test asserts it. [D15]
- **Rate limits** [D16]:
  | Limit | Default | Counted from |
  |---|---|---|
  | Generations per IP | 10 / hour | `runs` where `source = user`, any status |
  | Generations globally | 50 / rolling 24 h (placeholder) | `runs` where `source = user` |
  Set the global cap ≤ the project's requests-per-day ÷ 6 (worst case: 3 steps × 2 attempts). Requests with no identifiable IP share one bucket.
- **Billing:** the Gemini project has no billing account, so no charges are possible (PRD M6).
- **Client IP:** first address of `x-forwarded-for`, else `x-real-ip`; hashed with `IP_HASH_SALT`; raw IP never stored.
- **Public data:** Generate-tab notice (stored, public, processed by Gemini's free tier). Moderation: `update products set hidden = true where id = …`. `/api/runs` exposes metadata only.
- **Prompt injection:** §5 prompt construction; §7 known limitations.
- **Eval harness auth (Stage 2):** `X-Eval-Token` must equal `EVAL_TOKEN`, checked with a constant-time comparison (`crypto.timingSafeEqual`), not `===`. `EVAL_TOKEN` unset means this target doesn't accept eval traffic at all — the deployed public demo (Stage 3) can leave it unset, since a valid token bypasses the rate limits (§8, §9) that otherwise bound the project's free-tier quota.

### 11. Non-Functional Requirements
- **Latency:** PRD M5; throttled runs reported separately.
- **Error handling:** every Gemini call has a timeout; the stream always ends with `result` or `error`; no unhandled rejections.
- **Secrets:** env vars only; `.env.local.example` committed.
- **Local setup:** `docker compose up -d db` → `npm run migrate` → `npm run seed` → `npm run dev`.
- **Deployment (Stage 3):** migrations and seed over Supabase's direct connection; the app uses the pooled connection string; `vercel deploy`.

### 12. Environment Variables
| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | free-tier project, no billing |
| `MODEL_STRONG` | `gemini-3.8-flash` | |
| `MODEL_CHEAP` | `gemini-3.5-flash-lite` | |
| `DATABASE_URL` | local compose URL | server-side only |
| `TEST_DATABASE_URL` | local compose test DB | integration tests |
| `IP_HASH_SALT` | — | ≥ 16 chars |
| `RATE_LIMIT_GENERATE_PER_HOUR` | 10 | |
| `GLOBAL_DAILY_GENERATION_CAP` | 50 | see §10 |
| `EVAL_TOKEN` | — | Stage 2; unset disables eval traffic on this target (§10) |
| `JUDGE_MODEL` | `gemini-3.5-flash-lite` | Stage 2; deliberately a different tier than `MODEL_STRONG` so the judge isn't the same model grading itself (§9, risk table §9 in PRD.md) |
| `EVAL_TARGET_RPM` | 6 | Stage 2; CLI's own pacing against `--target`, independent of `RATE_LIMIT_GENERATE_PER_HOUR` |

### 13. Testing & CI
- **Unit — domain (no mocks):** every guardrail rule, table-driven, including false positives ("classic", "plastic-free" on a steel bottle, "pet treats"); normalization; name selection; first-run cash; prompt versions; result-builder invariant; request schema; every output schema converts to JSON Schema without unsupported keywords.
- **Unit — adapters:** transport retry with a fake clock and sleeper (retries 429/503, stops on non-retryable, honors retry delay, respects the deadline, doesn't retry daily quota); Gemini response and error mapping.
- **Unit — service** with a fake `LlmClient` and in-memory store: event order; retry prompt lists failed rules; second content failure rejects with no content; transport failures don't consume quality attempts; deadline → error; prompt block → rejected at input; stream always terminates.
- **Integration** (Docker Postgres test database): migrations apply and re-run as a no-op; seed invariants; RLS on every table; `finishRun` rolls back completely on failure; rate-limit counts.
- **CI (GitHub Actions)** on push/PR: lint, typecheck, unit tests, integration tests against a Postgres service container.

### 14. Repository Layout
```
app/
  page.tsx                          # tabs: Generate · Gallery · Under the hood
  api/{generate,categories,products,brands/[id],runs,eval/summary}/route.ts
components/                         # generate/, gallery/, runs/, ui/
lib/
  contracts/                        # Zod API contracts shared with the browser
  domain/                           # agents, prompts, guardrails, nameSelection, feasibility, result
  services/                         # ports, runGeneration, runStep, admission (rate limits)
  adapters/                         # gemini/, qwen/, postgres/, createLlmClient, env
  client/                           # NDJSON reader, generation state reducer
  eval/                             # Stage 2: fixture, judge, runner, metrics, stats, aggregate
config/                             # routing, limits, word lists
db/                                 # migrations/, seed.sql
scripts/                            # migrate, seed, check-models, observe-stream, eval
tests/                              # unit/, integration/
```

### 15. Out of Scope
- Authentication, multi-tenancy, per-user privacy.
- Real supplier integrations; trademark search.
- Paid LLM APIs; multiple providers.
- Semantic search, embeddings, vector databases. [D14]
- Orchestration frameworks. [D24]
- Live quality scoring of user runs. [D4]
- Production-grade abuse prevention beyond §10.
