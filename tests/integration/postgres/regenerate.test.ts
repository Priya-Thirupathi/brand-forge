import { beforeEach, describe, expect, it } from "vitest";
import { loadAlternateNaming } from "@/lib/adapters/postgres/regenerate";
import type { CategoryFacts } from "@/lib/domain/types";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

let seeded: SeededCategory;

beforeEach(async () => {
  await resetDb();
  seeded = await seedCategory();
});

// Mirrors the seeded row — loadAlternateNaming re-checks candidates against these keywords
// rather than trusting the `passed` flag stored with them.
const category: CategoryFacts = { slug: "water_bottle", displayName: "Water Bottle", keywords: ["water bottle", "bottle"] };

const CANDIDATES = [
  { name: "Ridge", rationale: "clear and rugged", passed: true, violations: [] },
  { name: "TrailBolt", rationale: "backup option", passed: true, violations: [] },
  { name: "Water Bottle", rationale: "descriptive", passed: false, violations: [] },
];

// No `run_steps` row is ever inserted here, on purpose: reading candidates off the run row is
// what makes a regenerate of a regenerate work, since a regenerated run skipped naming and so
// has no naming step of its own.
async function insertRun(nameCandidates: unknown): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `insert into runs
       (source, idea, category, feasibility_option_id, status, prompt_versions, name_candidates, client_ip_hash)
     values ('user', 'a trail water bottle', $1, $2, 'succeeded', '{}'::jsonb, $3::jsonb, 'hash-a')
     returning id`,
    [seeded.category, seeded.defaultOptionId, nameCandidates === null ? null : JSON.stringify(nameCandidates)],
  );
  return rows[0].id;
}

describe("loadAlternateNaming", () => {
  it("pins the chosen alternate and carries the whole candidate set with it", async () => {
    const runId = await insertRun(CANDIDATES);
    const result = await loadAlternateNaming(testPool, runId, "TrailBolt", category);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.naming.selectedName).toBe("TrailBolt");
    // The full set comes back, failures included — buildSucceededOutcome filters it for display,
    // and storing it again is what lets the *next* regenerate read it off the new run.
    expect(result.naming.candidates.map((c) => c.name)).toEqual(["Ridge", "TrailBolt", "Water Bottle"]);
  });

  it("re-checks the name against current rules instead of trusting the stored passed flag", async () => {
    // Stored as passing, but "Water Bottle" is nothing but this category's own keywords — the
    // rules say no, and the rules are what decides, not the flag written months ago.
    const runId = await insertRun(CANDIDATES.map((c) => ({ ...c, passed: true })));
    expect(await loadAlternateNaming(testPool, runId, "Water Bottle", category)).toEqual({ ok: false, reason: "not_a_candidate" });
  });

  it("refuses a name that run never produced", async () => {
    const runId = await insertRun(CANDIDATES);
    expect(await loadAlternateNaming(testPool, runId, "Hydrobolt", category)).toEqual({ ok: false, reason: "not_a_candidate" });
  });

  it("refuses an unknown run", async () => {
    expect(await loadAlternateNaming(testPool, "00000000-0000-0000-0000-000000000000", "Ridge", category)).toEqual({
      ok: false,
      reason: "unknown_run",
    });
  });

  it("refuses a run that never reached naming", async () => {
    const runId = await insertRun(null);
    expect(await loadAlternateNaming(testPool, runId, "Ridge", category)).toEqual({ ok: false, reason: "unknown_run" });
  });

  it("refuses a brand follow-up, which had no naming step to offer alternatives from", async () => {
    const runId = await insertRun([]);
    expect(await loadAlternateNaming(testPool, runId, "Ridge", category)).toEqual({ ok: false, reason: "unknown_run" });
  });
});
