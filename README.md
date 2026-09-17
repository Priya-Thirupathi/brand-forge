# BrandForge

A small end-to-end web app: pick a product category and material, write a one-sentence product
idea, and a chain of AI agents produces a brand kit — three name candidates (one selected), a
tagline, a description, and packaging copy — grounded in an illustrative manufacturing estimate
(material, per-unit cost range, minimum order quantity, lead time, first-run cash needed).

The estimate is looked up *before* generation and constrains what the copy may claim. Every run
is logged step by step and checked against guardrails before anything is shown. Past generations
form a public gallery.

This is a portfolio project demonstrating full-stack product engineering around AI agents: the
agent harness, the manufacturing constraints, and the product surface. It runs entirely on
free-tier infrastructure (no billing account attached to the Gemini project — see `DECISIONS.md`
D2).

`PRD.md`, `TRD.md`, and `DECISIONS.md` are the source of truth for scope, architecture, and every
non-obvious decision (with rejected alternatives). This README only covers running the thing.

## Stack

Next.js (App Router) · TypeScript · Postgres (`pg`, hand-rolled migrations, no ORM) · Gemini via
`@google/genai` · Zod · Tailwind. Layered code with ESLint-enforced import boundaries — see
`TRD.md` §2 and D23.

## Setup

```bash
docker compose up -d db
npm install
cp .env.local.example .env.local   # fill in GEMINI_API_KEY and IP_HASH_SALT at minimum
npm run migrate
npm run seed
npm run dev
```

Open http://localhost:3000. `npm run check-models` confirms `GEMINI_API_KEY` and the configured
model IDs actually work before you rely on them in the UI.

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

## Local-dev-only: testing against Qwen instead of Gemini

Gemini's free tier has a small daily quota that a single testing session can exhaust. To test
without spending it, `.env.local.example` has a commented-out block that points the app at Qwen
(via [Groq](https://console.groq.com)'s free tier) instead. This never takes effect in a
production build regardless of those variables being set — see D26 in `DECISIONS.md`.

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
