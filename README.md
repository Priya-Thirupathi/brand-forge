# BrandForge

**Live demo: [brand-forge-mu-six.vercel.app](https://brand-forge-mu-six.vercel.app/)**

A small end-to-end web app: pick a product category and material, write a one-sentence product
idea, and a chain of AI agents produces a brand kit — three name candidates (one selected), a
tagline, a description, and packaging copy — grounded in an illustrative manufacturing estimate
(material, per-unit cost range, minimum order quantity, lead time, first-run cash needed).

The estimate is looked up *before* generation and constrains what the copy may claim. Every run
is logged step by step and checked against guardrails before anything is shown. Past generations
form a public gallery.

This is a portfolio project demonstrating full-stack product engineering around AI agents: the
agent harness, the manufacturing constraints, and the product surface. It runs entirely on
free-tier LLM infrastructure — no billing account attached to either provider, so the live demo
carries zero spend risk (see `DECISIONS.md` D2).

`ARCHITECTURE.md` is a short narrative tour of the system's more interesting engineering choices.
`PRD.md`, `TRD.md`, and `DECISIONS.md` are the exhaustive source of truth for scope, architecture,
and every non-obvious decision (with rejected alternatives). This README only covers running the
thing.

## Stack

Next.js (App Router) · TypeScript · Postgres (`pg`, hand-rolled migrations, no ORM; Neon in
production, local Docker in dev) · Zod · Tailwind, deployed on Vercel. Two interchangeable
free-tier LLM providers behind one interface (`LlmClient`, D2) — Qwen via Groq (the live demo's
current default) or Gemini via `@google/genai`. Layered code with ESLint-enforced import
boundaries — see `TRD.md` §2 and D23.

## Setup

```bash
docker compose up -d db
npm install
cp .env.local.example .env.local   # fill in GROQ_API_KEY and IP_HASH_SALT at minimum
npm run migrate
npm run seed
npm run dev
```

Open http://localhost:3000. `npm run check-models` confirms the configured provider's API key
and model IDs actually work before you rely on them in the UI — it checks whichever provider
`LLM_PROVIDER` selects (Qwen/Groq by default in `.env.local.example`; see below).

### Integration test database

Integration tests run against a second, real Postgres database (not mocked), created once:

```bash
docker exec <db container name> psql -U brandforge -d brandforge -c "CREATE DATABASE brandforge_test"
DATABASE_URL="$TEST_DATABASE_URL" npm run migrate   # applies migrations to it too
```

Find the container name with `docker compose ps`.

## Testing

```bash
npm run lint
npm run typecheck
npm test               # unit — pure/mocked, no services required
npm run test:integration   # needs the test database above running
```

CI (`.github/workflows/ci.yml`) runs all four against a fresh Postgres service container on
every push and pull request.

## LLM provider: Qwen (default) or Gemini

Gemini's free tier has a small daily quota that a single testing session (or a public demo) can
exhaust — it did, repeatedly, including on the deployed demo itself (D2). `LLM_PROVIDER=qwen`
(set by default in this repo's own `.env.local.example` and in production) points the app at Qwen
via [Groq](https://console.groq.com)'s free tier instead, using `GROQ_API_KEY`. Leaving
`LLM_PROVIDER` unset falls back to Gemini (`GEMINI_API_KEY`) — see D26 in `DECISIONS.md`. One
accepted gap either way: Groq/Qwen exposes no equivalent of Gemini's safety feedback (D22), so
moderation guardrails beyond the app's own banned-word/claims checks don't get exercised while
Qwen is the active provider.

## Evaluation harness (Stage 2)

```bash
# set EVAL_TOKEN in .env.local first — see .env.local.example
npm run dev   # in one terminal

# in another terminal, against that running target:
npm run eval -- generate --target http://localhost:3000 --label "baseline" --repeats 3 --set-baseline
npm run eval -- generate --target http://localhost:3000 --label "naming-degraded" --repeats 3 --prompt-variant naming=degraded
npm run eval -- compare --run <the naming-degraded eval run's id>
```

Runs the 20-case fixture (`lib/eval/fixture.ts`) against a live target over HTTP — the same
`/api/generate` a browser calls, authenticated as eval traffic via `EVAL_TOKEN` (see `DECISIONS.md`
D27), so it bypasses the per-IP/global rate limits meant for real users. Each case × repeat is
scored (a judge model rates relevance/distinctiveness) and persisted as it completes, so an
interrupted run can continue later with `--resume <eval_run_id>` instead of starting over. Results
show up under the app's own "Under the hood" tab once `finished_at` is set.

The `--prompt-variant naming=degraded` run above is the sensitivity proof (`PRD.md` M4): it swaps
in a deliberately worse naming prompt and `compare` should flag it as a distinctiveness regression
— if it doesn't, don't trust any other comparison until that's understood.

## Recorded-run replay (Stage 5)

When the daily generation cap or the active provider's quota is exhausted, the Generate tab
offers **"Watch a recorded run instead"** — it streams the most recent real, public, succeeded
generation back with its original per-step timing (`GET /api/generate/replay`, no LLM call, no
admission checks). It's always labeled as a recorded run, never presented as live. A bad pick is
fixed the same way a bad gallery entry is: hide it (see Moderation, below) and the picker moves
to the next one.

## Alternate-name regenerate (Stage 5)

The naming step returns three candidates and picks the first that passes every name rule. The
others aren't decoration — a result card lists them under **"Rebuild around"**, and clicking one
regenerates the tagline, description and packaging around that name instead. Naming isn't called
again, so it costs two model calls rather than three.

The name is never taken at face value. The server re-reads that run's own candidates and re-checks
the one you picked against the current per-candidate name rules before using it, so the only names
that work are ones the guardrails have just re-approved — a hand-written `alternate_name` is a 400,
not a shortcut past them.

Each pick is a new brand, a new product and a new run; nothing overwrites what came before, so the
Gallery shows all of them and `runs.regenerated_from_run_id` records where each one branched from.
Regenerates chain — you can pick a third name off a result that was itself regenerated.

## Exact-match cache (Stage 5)

Submitting an idea that was generated before — same text, same category, same material option —
returns that stored result instead of spending three model calls, and the result is labelled as
such in the UI. Nothing new is written, so the Gallery doesn't grow a second identical card.

The key includes the prompt versions and the model each step would use right now, not just the
idea, so editing a prompt or switching provider invalidates it rather than serving copy the
current setup would never produce. Eval traffic ignores the cache entirely — the fixture's
repeats exist to measure run-to-run variance, and serving them identical rows would erase it.

Set `GENERATION_CACHE=off` when you want every submission to really generate.

## Moderation

There's no admin UI for removing a generation from the public gallery. Hide one manually:

```sql
update products set hidden = true where id = '<product id>';
-- to hide every product under a brand too:
update brands set hidden = true where id = '<brand id>';
```

`/api/products` and the gallery UI both exclude hidden rows; `/api/runs` is metadata-only and was
never gated on this (a run's existence isn't sensitive, only its content).

## Known placeholders

- `db/seed.sql`'s costs, MOQs, and lead times are illustrative, not real supplier quotes — the UI
  labels them as such, but don't treat them as accurate for a real sourcing decision.
- `config/{bannedWords,regulatedClaims,famousBrands,materialVocabulary}.ts` are starter lists,
  not curated for completeness.
