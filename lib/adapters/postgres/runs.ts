import type { Pool } from "pg";
import type { StepName } from "@/lib/contracts/stepName";
import type { RunSummary } from "@/lib/contracts/runs";
import { decodeCursor, encodeCursor } from "../pagination";

interface RunRow {
  id: string;
  created_at: Date;
  status: "running" | "succeeded" | "rejected" | "error";
  category: string;
  idea: string;
  failure: { step: string; violations: { rule: string; message: string }[] } | { step: string; error: string; message: string } | null;
  quality_retries: number;
  transport_retries: number;
  latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
}

interface RunStepModelRow {
  run_id: string;
  step: StepName;
  model: string;
}

function toFailure(failure: RunRow["failure"]): RunSummary["failure"] {
  if (!failure) return undefined;
  if ("violations" in failure) {
    return { step: failure.step, rules: failure.violations.map((v) => v.rule) } as RunSummary["failure"];
  }
  return { step: failure.step, error: failure.error } as RunSummary["failure"];
}

// TRD.md §8 GET /api/runs: metadata only, never raw_output, a non-succeeded run's idea, or an
// IP hash. Keyset-paginated over (created_at, id), like /api/products.
export async function listRuns(pool: Pool, params: { limit: number; cursor?: string }): Promise<{ runs: RunSummary[]; nextCursor: string | null }> {
  const decodedCursor = params.cursor ? decodeCursor(params.cursor) : null;
  if (params.cursor && !decodedCursor) return { runs: [], nextCursor: null };

  const conditions: string[] = [];
  const values: unknown[] = [];
  if (decodedCursor) {
    values.push(decodedCursor.createdAt, decodedCursor.id);
    conditions.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`);
  }
  values.push(params.limit + 1);

  const { rows } = await pool.query<RunRow>(
    `select id, created_at, status, category, idea, failure,
            quality_retries, transport_retries, latency_ms,
            input_tokens, output_tokens, thinking_tokens
     from runs
     ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
     order by created_at desc, id desc
     limit $${values.length}`,
    values,
  );

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const last = page[page.length - 1];

  const modelsByRun = page.length > 0 ? await loadModelsByRun(pool, page.map((row) => row.id)) : new Map<string, Partial<Record<StepName, string>>>();

  return {
    runs: page.map((row) => ({
      id: row.id,
      created_at: row.created_at.toISOString(),
      status: row.status,
      category: row.category,
      idea: row.status === "succeeded" ? row.idea : undefined,
      failure: toFailure(row.failure),
      models: modelsByRun.get(row.id) ?? {},
      quality_retries: row.quality_retries,
      transport_retries: row.transport_retries,
      latency_ms: row.latency_ms,
      tokens: { input: row.input_tokens, output: row.output_tokens, thinking: row.thinking_tokens },
    })),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

async function loadModelsByRun(pool: Pool, runIds: string[]): Promise<Map<string, Partial<Record<StepName, string>>>> {
  const { rows } = await pool.query<RunStepModelRow>(
    `select distinct on (run_id, step) run_id, step, model
     from run_steps
     where run_id = any($1)
     order by run_id, step, attempt desc`,
    [runIds],
  );
  const modelsByRun = new Map<string, Partial<Record<StepName, string>>>();
  for (const row of rows) {
    const models = modelsByRun.get(row.run_id) ?? {};
    models[row.step] = row.model;
    modelsByRun.set(row.run_id, models);
  }
  return modelsByRun;
}
