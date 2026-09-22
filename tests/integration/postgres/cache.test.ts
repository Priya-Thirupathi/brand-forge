import { beforeEach, describe, expect, it } from "vitest";
import { findCachedRun } from "@/lib/adapters/postgres/cache";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

let seeded: SeededCategory;

beforeEach(async () => {
  await resetDb();
  seeded = await seedCategory();
  process.env.MODEL_STRONG = "model-a";
});

const PROMPT_VERSIONS = { naming: "pv-n", tagline_description: "pv-t", packaging: "pv-p" };

interface FixtureOverrides {
  idea?: string;
  source?: "user" | "eval";
  status?: "succeeded" | "error";
  promptVersions?: Record<string, string>;
  stepModel?: string;
  skipNaming?: boolean;
  productHidden?: boolean;
  optionId?: string;
}

async function insertRun(overrides: FixtureOverrides = {}): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `insert into runs (source, idea, category, feasibility_option_id, status, prompt_versions, client_ip_hash,
                       quality_retries, transport_retries, input_tokens, output_tokens, thinking_tokens, latency_ms)
     values ($1, $2, $3, $4, $5, $6::jsonb, 'h', 0, 0, 10, 20, 0, 1200) returning id`,
    [
      overrides.source ?? "user",
      overrides.idea ?? "a steel water bottle for cyclists",
      seeded.category,
      overrides.optionId ?? seeded.defaultOptionId,
      overrides.status ?? "succeeded",
      JSON.stringify(overrides.promptVersions ?? PROMPT_VERSIONS),
    ],
  );
  const runId = rows[0].id;

  const { rows: brandRows } = await testPool.query<{ id: string }>(
    `insert into brands (name, tone_notes, source) values ('Ridge', '{"voice":[],"audience":"a","personality":"p","avoid":[]}'::jsonb, 'user') returning id`,
  );
  await testPool.query(
    `insert into products (brand_id, run_id, category, feasibility_snapshot, idea, tagline, description, packaging, source, hidden)
     values ($1, $2, $3, $4::jsonb, 'idea', 'Carry cold', 'A steel bottle.', '{"headline":"h","body":"b","callouts":[]}'::jsonb, 'user', $5)`,
    [
      brandRows[0].id,
      runId,
      seeded.category,
      JSON.stringify({ material: "Stainless Steel", materialTerms: [], costLow: 3.2, costHigh: 4.8, currency: "USD", moq: 500, leadTimeDaysLow: 35, leadTimeDaysHigh: 50, assumptions: "x" }),
      overrides.productHidden ?? false,
    ],
  );

  const steps = overrides.skipNaming ? ["tagline_description", "packaging"] : ["naming", "tagline_description", "packaging"];
  for (const step of steps) {
    await testPool.query(
      `insert into run_steps (run_id, step, attempt, model, prompt_version, latency_ms, violations, input_tokens, output_tokens, thinking_tokens, transport_retries)
       values ($1, $2, 1, $3, 'pv', 400, '[]'::jsonb, 1, 1, 0, 0)`,
      [runId, step, overrides.stepModel ?? "model-a"],
    );
  }
  return runId;
}

function key(overrides: Partial<Parameters<typeof findCachedRun>[1]> = {}) {
  return {
    idea: "a steel water bottle for cyclists",
    category: seeded.category,
    feasibilityOptionId: seeded.defaultOptionId,
    promptVersions: PROMPT_VERSIONS,
    ...overrides,
  };
}

describe("findCachedRun", () => {
  it("returns the stored result for an identical idea, ignoring case and surrounding space", async () => {
    const runId = await insertRun();
    const hit = await findCachedRun(testPool, key({ idea: "  A Steel Water Bottle For Cyclists " }));
    expect(hit?.run_id).toBe(runId);
    expect(hit?.brand?.name).toBe("Ridge");
    expect(hit?.product?.tagline).toBe("Carry cold");
  });

  it("misses on a different idea, category option, or prompt version", async () => {
    await insertRun();
    expect(await findCachedRun(testPool, key({ idea: "a steel water bottle for runners" }))).toBeNull();
    expect(await findCachedRun(testPool, key({ feasibilityOptionId: seeded.otherOptionId }))).toBeNull();
    // A prompt edit changes its content hash (D17); serving the old copy would hand back text
    // the current prompts would never produce.
    expect(await findCachedRun(testPool, key({ promptVersions: { ...PROMPT_VERSIONS, naming: "pv-n2" } }))).toBeNull();
  });

  it("misses when the step's model is no longer the one that would run now", async () => {
    // This project swapped provider in production (D2, Gemini → Qwen). A cache keyed only on
    // the input would have gone on serving the old provider's copy indefinitely.
    await insertRun({ stepModel: "model-old" });
    expect(await findCachedRun(testPool, key())).toBeNull();
  });

  it("never serves an eval run, a failed run, or a hidden one", async () => {
    await insertRun({ source: "eval" });
    expect(await findCachedRun(testPool, key())).toBeNull();

    await resetDb();
    seeded = await seedCategory();
    await insertRun({ status: "error" });
    expect(await findCachedRun(testPool, key())).toBeNull();

    await resetDb();
    seeded = await seedCategory();
    await insertRun({ productHidden: true });
    expect(await findCachedRun(testPool, key())).toBeNull();
  });

  it("never serves a run that skipped a step", async () => {
    // A follow-up or regenerate never calls naming, and its copy was shaped by an inherited
    // tone or a pinned name — inputs this key doesn't capture.
    await insertRun({ skipNaming: true });
    expect(await findCachedRun(testPool, key())).toBeNull();
  });
});
