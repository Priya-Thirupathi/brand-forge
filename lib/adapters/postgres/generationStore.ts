import type { Pool, PoolClient } from "pg";
import type {
  FeasibilityOption,
  FinishedRun,
  FinishedRunIds,
  GenerationStore,
  NameCandidateRecord,
  NewRun,
  RunFailure,
  RunStepRecord,
  SucceededRunContent,
} from "@/lib/services/ports";

// jsonb columns need an explicit JSON string, not the raw JS value — `pg`'s default parameter
// serializer sends a JS array as a Postgres array literal (`{a,b}`), not JSON, and while it does
// happen to JSON.stringify a plain object, relying on that implicit behavior for some jsonb
// columns and not others invites exactly the bug this avoids. `?? null` turns `undefined` (pg
// itself rejects `undefined` bind params) into SQL NULL.
function toJsonb(value: unknown): string {
  return JSON.stringify(value ?? null);
}

interface FeasibilityOptionRow {
  id: string;
  category: string;
  material: string;
  material_terms: string[];
  cost_low: number;
  cost_high: number;
  currency: string;
  moq: number;
  lead_time_days_low: number;
  lead_time_days_high: number;
  assumptions: string;
}

function toFeasibilityOption(row: FeasibilityOptionRow): FeasibilityOption {
  return {
    id: row.id,
    category: row.category,
    material: row.material,
    materialTerms: row.material_terms,
    costLow: row.cost_low,
    costHigh: row.cost_high,
    currency: row.currency,
    moq: row.moq,
    leadTimeDaysLow: row.lead_time_days_low,
    leadTimeDaysHigh: row.lead_time_days_high,
    assumptions: row.assumptions,
  };
}

// cost_low/cost_high are `numeric(10,2)` — cast to float8 in SQL so `pg` returns a JS number,
// not the string it returns for NUMERIC by default (precision-loss avoidance that doesn't
// matter at 2 decimal places here, but does mean an uncast column comes back as "3.20", not 3.2).
const FEASIBILITY_OPTION_COLUMNS = `
  id, category, material, material_terms,
  cost_low::float8 as cost_low, cost_high::float8 as cost_high,
  currency, moq, lead_time_days_low, lead_time_days_high, assumptions
`;

export function createPostgresGenerationStore(pool: Pool): GenerationStore {
  return {
    async findOption(category, optionId) {
      const { rows } = optionId
        ? await pool.query<FeasibilityOptionRow>(
            `select ${FEASIBILITY_OPTION_COLUMNS} from feasibility_options where category = $1 and id = $2`,
            [category, optionId],
          )
        : await pool.query<FeasibilityOptionRow>(
            `select ${FEASIBILITY_OPTION_COLUMNS} from feasibility_options where category = $1 and is_default`,
            [category],
          );
      return rows[0] ? toFeasibilityOption(rows[0]) : null;
    },

    async countRuns(filter) {
      // TRD.md §10: both the per-IP and global limits count only `source = 'user'` runs, any
      // status — an in-flight `running` row still counts, so a burst of concurrent requests
      // can't slip past the cap before any of them finishes.
      const { rows } = filter.ipHash
        ? await pool.query<{ count: number }>(
            `select count(*)::int as count from runs where source = 'user' and created_at >= $1 and client_ip_hash = $2`,
            [filter.since, filter.ipHash],
          )
        : await pool.query<{ count: number }>(
            `select count(*)::int as count from runs where source = 'user' and created_at >= $1`,
            [filter.since],
          );
      return rows[0].count;
    },

    async startRun(run: NewRun) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into runs (source, idea, category, feasibility_option_id, status, prompt_versions, client_ip_hash, resumed_from_run_id, regenerated_from_run_id, eval_run_id)
         values ($1, $2, $3, $4, 'running', '{}'::jsonb, $5, $6, $7, $8)
         returning id`,
        [
          run.source,
          run.idea,
          run.category,
          run.feasibilityOptionId,
          run.clientIpHash,
          run.resumedFromRunId ?? null,
          run.regeneratedFromRunId ?? null,
          run.evalRunId ?? null,
        ],
      );
      return rows[0].id;
    },

    async finishRun(record: FinishedRun) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await updateRun(client, record);
        await insertRunSteps(client, record.runId, record.steps);
        const ids = record.status === "succeeded" ? await insertBrandAndProduct(client, record.runId, record) : undefined;
        await client.query("commit");
        return ids;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function updateRun(client: PoolClient, record: FinishedRun): Promise<void> {
  const failure: RunFailure | null = record.status === "succeeded" ? null : record.failure;
  const nameCandidates: NameCandidateRecord[] | null = record.nameCandidates ?? null;

  await client.query(
    `update runs set
       status = $2,
       failure = $3::jsonb,
       name_candidates = $4::jsonb,
       prompt_versions = $5::jsonb,
       input_tokens = $6,
       output_tokens = $7,
       thinking_tokens = $8,
       quality_retries = $9,
       transport_retries = $10,
       latency_ms = $11,
       first_event_ms = $12,
       finished_at = now()
     where id = $1`,
    [
      record.runId,
      record.status,
      toJsonb(failure),
      toJsonb(nameCandidates),
      toJsonb(record.promptVersions),
      record.usage.promptTokens,
      record.usage.candidatesTokens,
      record.usage.thoughtsTokens,
      record.qualityRetries,
      record.transportRetries,
      record.latencyMs,
      record.firstEventMs ?? null,
    ],
  );
}

async function insertRunSteps(client: PoolClient, runId: string, steps: RunStepRecord[]): Promise<void> {
  for (const step of steps) {
    await client.query(
      `insert into run_steps
         (run_id, step, attempt, model, prompt_version, input_tokens, output_tokens, thinking_tokens,
          transport_retries, latency_ms, raw_output, violations, error)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
      [
        runId,
        step.step,
        step.attempt,
        step.model,
        step.promptVersion,
        step.usage.promptTokens,
        step.usage.candidatesTokens,
        step.usage.thoughtsTokens,
        step.transportRetries,
        step.latencyMs,
        toJsonb(step.rawOutput ?? null),
        toJsonb(step.violations),
        step.error ?? null,
      ],
    );
  }
}

async function insertBrandAndProduct(
  client: PoolClient,
  runId: string,
  record: Extract<FinishedRun, { status: "succeeded" }>,
): Promise<FinishedRunIds> {
  const { content } = record;

  // A follow-up (D29) attaches to the brand it named, rather than creating a new one.
  const brandId = content.existingBrandId ?? (await insertBrand(client, runId, content));

  const { rows: productRows } = await client.query<{ id: string }>(
    `insert into products
       (brand_id, run_id, category, feasibility_option_id, feasibility_snapshot, idea, tagline, description, packaging, source, hidden)
     select $2, $1, category, feasibility_option_id, $3::jsonb, idea, $4, $5, $6::jsonb, source, false
     from runs where id = $1
     returning id`,
    [runId, brandId, toJsonb(content.feasibilitySnapshot), content.tagline, content.description, toJsonb(content.packaging)],
  );

  return { brandId, productId: productRows[0].id };
}

// `source` comes from the `runs` row itself (set once at startRun and never changed) rather
// than being threaded through the service layer a second time — one less thing for the two
// copies to drift out of sync on.
async function insertBrand(client: PoolClient, runId: string, content: SucceededRunContent): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into brands (name, tone_notes, source, hidden)
     select $2, $3::jsonb, source, false from runs where id = $1
     returning id`,
    [runId, content.brandName, toJsonb(content.toneNotes)],
  );
  return rows[0].id;
}
