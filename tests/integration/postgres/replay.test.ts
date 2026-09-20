import { beforeEach, describe, expect, it } from "vitest";
import { findReplayableRun } from "@/lib/adapters/postgres/replay";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

let category: SeededCategory;

beforeEach(async () => {
  await resetDb();
  category = await seedCategory();
});

interface RunOverrides {
  status?: "running" | "succeeded" | "rejected" | "error";
  source?: "user" | "eval";
  brandHidden?: boolean;
  productHidden?: boolean;
  createdAt?: string;
  nameCandidates?: { name: string; rationale: string; passed: boolean }[];
  noSteps?: boolean;
}

const DEFAULT_NAME_CANDIDATES = [
  { name: "Ridge", rationale: "clear and rugged", passed: true },
  { name: "PureFlow", rationale: "cliché prefix", passed: false },
  { name: "TrailBolt", rationale: "backup option", passed: true },
];

// Mirrors what a real succeeded run actually persists across runs/brands/products/run_steps —
// enough of it for findReplayableRun's join + reconstruction, not the full column set every
// other adapter test already covers.
async function insertReplayableFixture(overrides: RunOverrides = {}): Promise<{ runId: string; brandId: string; productId: string }> {
  const { rows: runRows } = await testPool.query<{ id: string }>(
    `insert into runs
       (source, idea, category, feasibility_option_id, status, prompt_versions, name_candidates,
        quality_retries, transport_retries, input_tokens, output_tokens, thinking_tokens, latency_ms,
        client_ip_hash, created_at)
     values ('user', 'a trail water bottle', $1, $2, $3, '{}'::jsonb, $4::jsonb,
             0, 0, 100, 200, 10, 1500, 'hash-a', coalesce($5::timestamptz, now()))
     returning id`,
    [category.category, category.defaultOptionId, overrides.status ?? "succeeded", JSON.stringify(overrides.nameCandidates ?? DEFAULT_NAME_CANDIDATES), overrides.createdAt ?? null],
  );
  const runId = runRows[0].id;

  // A run's own `source` column drives admission/rate-limiting; a run's *content* (brand/
  // product) is what carries `source`/`hidden` for the gallery — findReplayableRun filters on
  // both, same as listProducts (gallery.ts), so overrides.source targets the run row itself.
  await testPool.query("update runs set source = $2 where id = $1", [runId, overrides.source ?? "user"]);

  const { rows: brandRows } = await testPool.query<{ id: string }>(
    `insert into brands (name, tone_notes, source, hidden)
     values ('Ridge', '{"voice":["bold"],"audience":"hikers","personality":"rugged","avoid":[]}'::jsonb, 'user', $1)
     returning id`,
    [overrides.brandHidden ?? false],
  );
  const brandId = brandRows[0].id;

  const { rows: productRows } = await testPool.query<{ id: string }>(
    `insert into products
       (brand_id, run_id, category, feasibility_option_id, feasibility_snapshot, idea, tagline, description, packaging, source, hidden)
     values ($1, $2, $3, $4,
             '{"material":"Stainless Steel","materialTerms":["steel"],"costLow":3.2,"costHigh":4.8,"currency":"USD","moq":500,"leadTimeDaysLow":35,"leadTimeDaysHigh":50,"assumptions":"test fixture"}'::jsonb,
             'a trail water bottle', 'Built for the trail', 'A rugged steel bottle for the trail.',
             '{"headline":"h","body":"b","callouts":["Rugged"]}'::jsonb, 'user', $5)
     returning id`,
    [brandId, runId, category.category, category.defaultOptionId, overrides.productHidden ?? false],
  );
  const productId = productRows[0].id;

  if (!overrides.noSteps) {
    await testPool.query(
      `insert into run_steps (run_id, step, attempt, model, prompt_version, latency_ms, violations, error, created_at)
       values
         ($1, 'naming', 1, 'qwen/qwen3.8-27b', 'v1', 900, '[]'::jsonb, null, now() - interval '3 seconds'),
         ($1, 'tagline_description', 1, 'qwen/qwen3.8-27b', 'v1', 700, '[]'::jsonb, null, now() - interval '2 seconds'),
         ($1, 'packaging', 1, 'qwen/qwen3.8-27b', 'v1', 800, '[]'::jsonb, null, now() - interval '1 seconds')`,
      [runId],
    );
  }

  return { runId, brandId, productId };
}

describe("findReplayableRun", () => {
  it("returns null when nothing is eligible", async () => {
    expect(await findReplayableRun(testPool)).toBeNull();
  });

  it("excludes a hidden product, a hidden brand, a non-succeeded run, and an eval-source run", async () => {
    await insertReplayableFixture({ productHidden: true, createdAt: "2026-01-04T00:00:00Z" });
    await insertReplayableFixture({ brandHidden: true, createdAt: "2026-01-03T00:00:00Z" });
    await insertReplayableFixture({ status: "error", createdAt: "2026-01-02T00:00:00Z" });
    await insertReplayableFixture({ source: "eval", createdAt: "2026-01-01T00:00:00Z" });

    expect(await findReplayableRun(testPool)).toBeNull();
  });

  it("picks the most recently created eligible run", async () => {
    await insertReplayableFixture({ createdAt: "2026-01-01T00:00:00Z" });
    const { runId: newest } = await insertReplayableFixture({ createdAt: "2026-01-05T00:00:00Z" });

    const replayable = await findReplayableRun(testPool);
    expect(replayable?.runId).toBe(newest);
  });

  it("returns null when the eligible run has no recorded steps", async () => {
    await insertReplayableFixture({ noSteps: true });
    expect(await findReplayableRun(testPool)).toBeNull();
  });

  it("reconstructs the full result, including only passing name candidates with the selected one flagged", async () => {
    const { runId, brandId, productId } = await insertReplayableFixture();

    const replayable = await findReplayableRun(testPool);
    expect(replayable?.runId).toBe(runId);
    expect(replayable?.result.status).toBe("succeeded");
    expect(replayable?.result.brand).toEqual({ id: brandId, name: "Ridge", tone_notes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] } });
    expect(replayable?.result.product).toMatchObject({ id: productId, tagline: "Built for the trail" });
    expect(replayable?.result.name_candidates).toEqual([
      { name: "Ridge", selected: true },
      { name: "TrailBolt", selected: false },
    ]);
    // moq 500 × cost 3.2..4.8 (seedCategory's default option), same formula as a live run
    // (lib/domain/feasibility.ts's firstRunCash).
    expect(replayable?.result.feasibility.first_run_cost_low).toBe(1600);
    expect(replayable?.result.feasibility.first_run_cost_high).toBe(2400);
  });

  it("orders steps chronologically and marks a step's passed state from its violations/error columns", async () => {
    await insertReplayableFixture();
    const replayable = await findReplayableRun(testPool);

    expect(replayable?.steps.map((s) => s.step)).toEqual(["naming", "tagline_description", "packaging"]);
    expect(replayable?.steps.every((s) => s.passed)).toBe(true);
    expect(replayable?.steps.map((s) => s.latencyMs)).toEqual([900, 700, 800]);
  });

  it("replays a step's failed-then-passed attempts in order", async () => {
    const { runId } = await insertReplayableFixture();
    await testPool.query("delete from run_steps where run_id = $1 and step = 'naming'", [runId]);
    await testPool.query(
      `insert into run_steps (run_id, step, attempt, model, prompt_version, latency_ms, violations, error, created_at)
       values
         ($1, 'naming', 1, 'qwen/qwen3.8-27b', 'v1', 600, '[{"rule":"name.banned_word","message":"x"}]'::jsonb, null, now() - interval '4 seconds'),
         ($1, 'naming', 2, 'qwen/qwen3.8-27b', 'v1', 650, '[]'::jsonb, null, now() - interval '3.5 seconds')`,
      [runId],
    );

    const replayable = await findReplayableRun(testPool);
    const namingSteps = replayable?.steps.filter((s) => s.step === "naming") ?? [];
    expect(namingSteps).toEqual([
      { step: "naming", attempt: 1, passed: false, latencyMs: 600 },
      { step: "naming", attempt: 2, passed: true, latencyMs: 650 },
    ]);
  });
});
