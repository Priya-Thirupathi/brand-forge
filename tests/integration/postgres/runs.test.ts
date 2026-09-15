import { beforeEach, describe, expect, it } from "vitest";
import { listRuns } from "@/lib/adapters/postgres/runs";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

let category: SeededCategory;

beforeEach(async () => {
  await resetDb();
  category = await seedCategory();
});

interface RunOverrides {
  status?: "running" | "succeeded" | "rejected" | "error";
  failure?: unknown;
  createdAt?: string;
}

async function insertRun(overrides: RunOverrides = {}): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `insert into runs
       (source, idea, category, feasibility_option_id, status, failure, prompt_versions, client_ip_hash, created_at)
     values ('user', 'a reusable water bottle', $1, $2, $3, $4::jsonb, '{}'::jsonb, 'hash-a', coalesce($5::timestamptz, now()))
     returning id`,
    [category.category, category.defaultOptionId, overrides.status ?? "succeeded", JSON.stringify(overrides.failure ?? null), overrides.createdAt ?? null],
  );
  return rows[0].id;
}

describe("listRuns", () => {
  it("exposes the idea only for a succeeded run", async () => {
    const succeededId = await insertRun({ status: "succeeded" });
    const rejectedId = await insertRun({ status: "rejected" });

    const { runs } = await listRuns(testPool, { limit: 24 });
    expect(runs.find((r) => r.id === succeededId)?.idea).toBe("a reusable water bottle");
    expect(runs.find((r) => r.id === rejectedId)?.idea).toBeUndefined();
  });

  it("maps a guardrail rejection's failure to its step and rule ids, dropping messages", async () => {
    const runId = await insertRun({
      status: "rejected",
      failure: { step: "naming", violations: [{ rule: "name.count", message: "expected 3, got 1" }] },
    });

    const { runs } = await listRuns(testPool, { limit: 24 });
    const run = runs.find((r) => r.id === runId);
    expect(run?.failure).toEqual({ step: "naming", rules: ["name.count"] });
  });

  it("maps a transport failure to its step and error reason, with no rules", async () => {
    const runId = await insertRun({
      status: "error",
      failure: { step: "packaging", error: "provider_error", message: "503 from Gemini" },
    });

    const { runs } = await listRuns(testPool, { limit: 24 });
    const run = runs.find((r) => r.id === runId);
    expect(run?.failure).toEqual({ step: "packaging", error: "provider_error" });
  });

  it("attaches each step's most recent attempt's model", async () => {
    const runId = await insertRun({ status: "succeeded" });
    await testPool.query(
      `insert into run_steps (run_id, step, attempt, model, prompt_version, latency_ms)
       values ($1, 'naming', 1, 'gemini-3.8-flash-old', 'v1', 500),
              ($1, 'naming', 2, 'gemini-3.8-flash', 'v1', 500)`,
      [runId],
    );

    const { runs } = await listRuns(testPool, { limit: 24 });
    expect(runs.find((r) => r.id === runId)?.models).toEqual({ naming: "gemini-3.8-flash" });
  });

  it("paginates newest-first with a cursor over (created_at, id)", async () => {
    const first = await insertRun({ createdAt: "2026-01-01T00:00:00Z" });
    const second = await insertRun({ createdAt: "2026-01-02T00:00:00Z" });

    const page1 = await listRuns(testPool, { limit: 1 });
    expect(page1.runs.map((r) => r.id)).toEqual([second]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listRuns(testPool, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.runs.map((r) => r.id)).toEqual([first]);
    expect(page2.nextCursor).toBeNull();
  });
});
