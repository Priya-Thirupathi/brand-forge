# Architecture Note

`PRD.md`/`TRD.md`/`DECISIONS.md` are the exhaustive spec — every table, type, and rejected
alternative lives there. This note is shorter and narrative: it's the tour a reviewer skimming the
repo would want, organized around three things the system actually has to get right — an agent
harness that fails safely, a product surface that's honest about what it doesn't know, and a
codebase that stays legible as both of those grow. Section numbers below point at `TRD.md` for
the full spec where one exists.

## Request lifecycle, in one pass

```
POST /api/generate
  1. Zod-validate the body, resolve category + material → a feasibility option (TRD §3)
  2. Rate-limit check (per-IP + global, Postgres-counted, TRD §10) — nothing persisted yet
  3. Input guardrails (banned words, TRD §7) — reject before any LLM call
  4. naming → tagline_description → packaging, each through the same runStep loop (below)
  5. One Postgres transaction: run_steps + brand + product, or nothing at all
  6. NDJSON stream: step_started/step_finished per step, then one result or error event
```

Steps 3–5 are the part worth reading closely, because "generate three pieces of copy with an LLM"
sounds like it should be one function, and structuring it as a pipeline with an explicit contract
between stages is most of what makes the rest of this note possible.

## The agent harness

Each of the three steps (`lib/domain/agents/*.ts`) is a plain data record, not a class:

```ts
{ step, outputSchema, prompt, toVariables(input), evaluate(output, input) }
```

A single generic `runStep` (`lib/services/runGeneration.ts`) executes any of them: render the
prompt → call the configured `LlmClient` → validate the JSON shape with Zod → run `evaluate` →
accept, retry once with the specific violations fed back into the prompt, or reject with no
content shown. Adding a fourth pipeline step, or changing what "packaging" checks, never touches
the orchestration loop — it's a new data record. This is the concrete shape of "the agent harness"
from a systems point of view: not a framework, a fold over a list of specs.

**Two failure modes get two different retry policies, on purpose (D21).** A 503 from the provider
and a name that fails the banned-word check are not the same kind of problem, and conflating them
either retries content failures pointlessly or lets a flaky network call masquerade as "the model
got it wrong." Transport retries (exponential backoff, full jitter, deadline-aware — never start a
retry that can't finish before the run's 25s deadline) live entirely inside the adapter and are
invisible to the domain layer. Quality retries (one, with the failed rules appended to the prompt)
live in the service layer and never see a network error. `TRD.md` §5's timeout/retry table has the
exact numbers.

**Guardrails run before anything is shown, not after (D7).** A rejected run surfaces which rule
failed and a plain-language reason — never the content that failed it. This is a real product
constraint (the app promises no generated output slips past a rejection), and it's also what
makes the eval harness's `outcome_match_rate` metric meaningful: a "rejected" case and a "the model
tried and the judge scored it low" case are distinguishable by construction, not by inspecting text.

## The manufacturing constraint (the part that isn't just an LLM wrapper)

Feasibility data — material, per-unit cost range, MOQ, lead time — is looked up **before** any
generation call, from a fixed table keyed by category + material (`TRD.md` §3). It's then injected
into every prompt as a trusted fact block, separate from the user's free-text idea, and a
material-consistency guardrail checks the output doesn't contradict it. Concretely: ask for a
"titanium water bottle" against a feasibility option that's actually stainless steel, and the
naming/copy agents are constrained to describe what can really be sourced, not what was asked for
— a guardrail catching the model being *more* honest than the prompt, which is the direction you
want that failure mode to point. `db/seed.sql`'s numbers are illustrative, not real supplier
quotes (README "Known placeholders"), but the feasibility-first *shape* — estimate before
generation, not generation validated against an estimate after the fact — is the actual design
choice, and it's what makes the "first-run cash needed" number on every result a real computed
value instead of set dressing.

## Provider swap, done live, in production (D2, D26)

`LlmClient` is a two-method interface (`generateJson`, essentially "take a request, never throw for
a provider failure, return a typed outcome"). Two implementations exist —
`lib/adapters/gemini/client.ts` and `lib/adapters/qwen/client.ts` — selected by one env var
(`LLM_PROVIDER`) read in exactly one place (`lib/adapters/createLlmClient.ts`), shared by both the
generation route and the eval harness's judge so the two call sites can't drift. The interesting
part isn't the abstraction itself — provider interfaces are standard — it's that the production
deployment actually switched providers after shipping, under real load, because Gemini's free-tier
daily quota kept getting exhausted by real demo traffic (not a hypothetical migration exercise).
The swap was one env var; the code didn't move. The accepted gap that came with it is documented
rather than hidden: Groq/Qwen has no equivalent of Gemini's safety-feedback moderation layer
(D22), so while Qwen is active, only the app's own provider-independent guardrails (banned words,
regulated claims, famous-brand checks) are doing that job — see `DECISIONS.md` D2's latest
revision for the full trade-off.

## Resumability — retrying without redoing what already succeeded

A run that fails at `packaging` after `naming` and `tagline_description` both succeeded doesn't
restart from scratch. `POST /api/generate` accepts `resume_from_run_id`; the server reconstructs
the earlier run's accepted steps by re-running the *same* domain `evaluate()` against their stored
raw output (`lib/adapters/postgres/resume.ts`) — not a hand-rolled copy, so a resumed step is
judged identically to a live one — and only calls the LLM for the steps that never succeeded. This
exists because it's a real cost/UX problem on a quota-constrained free tier: redoing two successful
LLM calls to retry a third failed one wastes exactly the resource (daily quota) the whole system is
designed around conserving.

## Running a multi-minute eval on serverless infrastructure

The eval harness (`TRD.md` §9) needs to run 20 cases × N repeats against a live target, each one a
real generation, which easily exceeds Vercel's per-invocation time limit. The first version fired
the run as an un-awaited background task — works under `next dev`, silently doesn't on serverless,
where nothing guarantees a process outlives its response. The shipped version instead makes every
`POST /api/eval/run` call a bounded, *awaited* chunk (`lib/eval/runner.ts`'s `runEvalFixture` takes
a deadline and stops before starting a case that would cross it); the browser tab that started the
run keeps calling back with `resume_eval_run_id` until the server reports `completed`. The rpm
pacer survives across those separate serverless invocations by seeding its clock from the most
recent persisted result's timestamp instead of assuming a warm in-memory state. `DECISIONS.md` D3's
"Revised 2026-09-18" entry has the full reasoning for rejecting a queue (real infra, but a paid
third-party dependency for a portfolio-scale feature) and `waitUntil` (extends the *response*
lifetime, not helpful when the run itself outlives one invocation's deadline either way).

## Codebase shape

Five layers, enforced by ESLint import-boundary rules rather than left as a convention someone can
accidentally violate (`TRD.md` §2, D23): `contracts` (Zod shapes shared by server and browser) →
`domain` (pure — no `pg`, no LLM SDK, no `next` — agent specs, guardrails, feasibility math) →
`services` (orchestration against small ports: `LlmClient`, `GenerationStore`, `Clock`) →
`adapters` (Postgres, Gemini, Qwen, retry/error mapping) → `app`/`components` (thin route handlers,
presentational UI). The practical payoff shows up in the tests: domain logic is tested with zero
mocks (it has no I/O to mock), and the service layer is tested against a `FakeLlmClient` and an
in-memory store rather than a real database or a real API key — 182 unit tests run in about a
second, with no network or Docker dependency, because most of the codebase simply can't reach out
to either.

## Where the evidence lives, not just the design

The eval harness's sensitivity proof (`PRD.md` M4) is the one number worth checking rather than
trusting: a baseline run and a run against a deliberately degraded naming prompt produce bootstrap
confidence intervals of **distinctiveness delta −0.267, 95% CI [−0.456, −0.089]** (entirely
negative — correctly flagged as regressed) versus **latency CI [−310ms, +170ms]** (crosses zero —
correctly *not* flagged). That's the harness distinguishing a real prompt regression from noise,
on data, not asserting it does.
