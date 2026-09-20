import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresGenerationStore } from "@/lib/adapters/postgres/generationStore";
import type { FinishedRun, NewRun, RunStepRecord, TokenUsage } from "@/lib/services/ports";
import { resetDb, seedCategory, testPool, type SeededCategory } from "../setup/testDb";

const store = createPostgresGenerationStore(testPool);

let category: SeededCategory;

beforeEach(async () => {
  await resetDb();
  category = await seedCategory();
});

afterAll(async () => {
  await testPool.end();
});

function zeroUsage(): TokenUsage {
  return { promptTokens: 0, candidatesTokens: 0, thoughtsTokens: 0, totalTokens: 0 };
}

function newRun(overrides: Partial<NewRun> = {}): NewRun {
  return {
    source: "user",
    idea: "a reusable water bottle for hikers",
    category: category.category,
    feasibilityOptionId: category.defaultOptionId,
    clientIpHash: "hash-a",
    ...overrides,
  };
}

function stepRecord(overrides: Partial<RunStepRecord> = {}): RunStepRecord {
  return {
    step: "naming",
    attempt: 1,
    model: "gemini-3.8-flash",
    promptVersion: "abc123def456",
    usage: { promptTokens: 10, candidatesTokens: 20, thoughtsTokens: 5, totalTokens: 35 },
    transportRetries: 0,
    latencyMs: 500,
    rawOutput: { candidates: [{ name: "Ridge", rationale: "short" }] },
    violations: [],
    ...overrides,
  };
}

describe("createPostgresGenerationStore", () => {
  describe("findOption", () => {
    it("returns the default option when no optionId is given", async () => {
      const option = await store.findOption(category.category);
      expect(option?.id).toBe(category.defaultOptionId);
      expect(option?.material).toBe("Stainless Steel");
    });

    it("returns numeric cost fields as numbers, not numeric-as-string", async () => {
      const option = await store.findOption(category.category);
      expect(typeof option?.costLow).toBe("number");
      expect(option?.costLow).toBe(3.2);
      expect(option?.costHigh).toBe(4.8);
    });

    it("returns the specific option when an optionId is given", async () => {
      const option = await store.findOption(category.category, category.otherOptionId);
      expect(option?.material).toBe("BPA-Free Plastic");
    });

    it("returns null for an unknown category", async () => {
      expect(await store.findOption("not_a_real_category")).toBeNull();
    });

    it("returns null when the option exists but belongs to a different category", async () => {
      await testPool.query(
        "insert into categories (slug, display_name, keywords, sort_order) values ('candle', 'Candle', array['candle'], 2)",
      );
      expect(await store.findOption("candle", category.defaultOptionId)).toBeNull();
    });
  });

  describe("countRuns", () => {
    it("counts zero with no runs", async () => {
      expect(await store.countRuns({ since: new Date(0) })).toBe(0);
    });

    it("counts only source = 'user' runs within the window, scoped by ipHash when given", async () => {
      await store.startRun(newRun({ clientIpHash: "hash-a" }));
      await store.startRun(newRun({ clientIpHash: "hash-a" }));
      await store.startRun(newRun({ clientIpHash: "hash-b" }));
      await store.startRun(newRun({ source: "eval", clientIpHash: "hash-a" }));

      expect(await store.countRuns({ since: new Date(0) })).toBe(3); // eval run excluded
      expect(await store.countRuns({ since: new Date(0), ipHash: "hash-a" })).toBe(2);
      expect(await store.countRuns({ since: new Date(0), ipHash: "hash-c" })).toBe(0);
    });

    it("excludes runs created before the `since` cutoff", async () => {
      const runId = await store.startRun(newRun());
      await testPool.query("update runs set created_at = now() - interval '2 hours' where id = $1", [runId]);

      expect(await store.countRuns({ since: new Date(Date.now() - 60 * 60 * 1000) })).toBe(0);
      expect(await store.countRuns({ since: new Date(Date.now() - 3 * 60 * 60 * 1000) })).toBe(1);
    });
  });

  describe("startRun", () => {
    it("inserts a running row and returns its id", async () => {
      const runId = await store.startRun(newRun());
      const { rows } = await testPool.query("select status, idea, source from runs where id = $1", [runId]);
      expect(rows[0]).toMatchObject({ status: "running", idea: newRun().idea, source: "user" });
    });
  });

  describe("finishRun", () => {
    it("persists a succeeded run's brand and product, reading source/category/idea back from the run row", async () => {
      const runId = await store.startRun(newRun());
      const record: FinishedRun = {
        runId,
        status: "succeeded",
        content: {
          brandName: "Ridge",
          toneNotes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] },
          tagline: "Built for the trail",
          description: "A steel bottle for hikers.",
          packaging: { headline: "Ridge water bottle", body: "Steel build.", callouts: ["Durable", "Insulated"] },
          feasibilitySnapshot: {
            material: "Stainless Steel",
            materialTerms: ["steel"],
            costLow: 3.2,
            costHigh: 4.8,
            currency: "USD",
            moq: 500,
            leadTimeDaysLow: 35,
            leadTimeDaysHigh: 50,
            assumptions: "test fixture",
          },
        },
        nameCandidates: [{ name: "Ridge", rationale: "short", passed: true, violations: [] }],
        promptVersions: { naming: "abc123def456" },
        usage: { promptTokens: 10, candidatesTokens: 20, thoughtsTokens: 5, totalTokens: 35 },
        qualityRetries: 0,
        transportRetries: 0,
        latencyMs: 1200,
        steps: [stepRecord()],
      };

      const ids = await store.finishRun(record);

      const { rows: runRows } = await testPool.query("select status, finished_at from runs where id = $1", [runId]);
      expect(runRows[0].status).toBe("succeeded");
      expect(runRows[0].finished_at).not.toBeNull();

      const { rows: stepRows } = await testPool.query("select step, attempt from run_steps where run_id = $1", [runId]);
      expect(stepRows).toHaveLength(1);
      expect(stepRows[0]).toMatchObject({ step: "naming", attempt: 1 });

      const { rows: productRows } = await testPool.query(
        "select id, tagline, category, idea, feasibility_option_id, source from products where run_id = $1",
        [runId],
      );
      expect(productRows).toHaveLength(1);
      expect(productRows[0]).toMatchObject({
        tagline: "Built for the trail",
        category: category.category,
        idea: newRun().idea,
        feasibility_option_id: category.defaultOptionId,
        source: "user",
      });

      const { rows: brandRows } = await testPool.query("select id, name, source from brands");
      expect(brandRows).toEqual([{ id: ids?.brandId, name: "Ridge", source: "user" }]);
      // The route handler (build step 7) needs these back to shape GenerateResult.brand/product.
      expect(ids).toEqual({ brandId: brandRows[0].id, productId: productRows[0].id });
    });

    it("attaches a product to an existing brand instead of creating a new one, when content.existingBrandId is set (D29 follow-up)", async () => {
      const firstRunId = await store.startRun(newRun());
      const firstIds = await store.finishRun({
        runId: firstRunId,
        status: "succeeded",
        content: {
          brandName: "Ridge",
          toneNotes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] },
          tagline: "Built for the trail",
          description: "A steel bottle for hikers.",
          packaging: { headline: "Ridge water bottle", body: "Steel build.", callouts: ["Durable"] },
          feasibilitySnapshot: {
            material: "Stainless Steel",
            materialTerms: ["steel"],
            costLow: 3.2,
            costHigh: 4.8,
            currency: "USD",
            moq: 500,
            leadTimeDaysLow: 35,
            leadTimeDaysHigh: 50,
            assumptions: "test fixture",
          },
        },
        nameCandidates: [{ name: "Ridge", rationale: "short", passed: true, violations: [] }],
        promptVersions: { naming: "abc123def456" },
        usage: zeroUsage(),
        qualityRetries: 0,
        transportRetries: 0,
        latencyMs: 1200,
        steps: [stepRecord()],
      });

      const secondRunId = await store.startRun(newRun({ idea: "a Ridge candle for the same brand" }));
      const secondIds = await store.finishRun({
        runId: secondRunId,
        status: "succeeded",
        content: {
          brandName: "Ridge",
          toneNotes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] },
          tagline: "Light your trail",
          description: "A candle for hikers who camp.",
          packaging: { headline: "Ridge candle", body: "Soy wax.", callouts: ["Long burn"] },
          feasibilitySnapshot: {
            material: "Stainless Steel",
            materialTerms: ["steel"],
            costLow: 3.2,
            costHigh: 4.8,
            currency: "USD",
            moq: 500,
            leadTimeDaysLow: 35,
            leadTimeDaysHigh: 50,
            assumptions: "test fixture",
          },
          existingBrandId: firstIds?.brandId,
        },
        // No naming candidates on a follow-up — nothing was named this run.
        nameCandidates: [],
        promptVersions: { tagline_description: "def456", packaging: "112233" },
        usage: zeroUsage(),
        qualityRetries: 0,
        transportRetries: 0,
        latencyMs: 900,
        steps: [],
      });

      expect(secondIds?.brandId).toBe(firstIds?.brandId);

      const { rows: brandRows } = await testPool.query("select id from brands");
      expect(brandRows).toHaveLength(1); // only ever one brand row, not two

      const { rows: productRows } = await testPool.query<{ brand_id: string; tagline: string }>(
        "select brand_id, tagline from products order by created_at",
      );
      expect(productRows).toHaveLength(2);
      expect(productRows.every((p) => p.brand_id === firstIds?.brandId)).toBe(true);
      expect(productRows.map((p) => p.tagline)).toEqual(["Built for the trail", "Light your trail"]);
    });

    it("persists a rejected run's failure with no brand or product", async () => {
      const runId = await store.startRun(newRun());
      const record: FinishedRun = {
        runId,
        status: "rejected",
        failure: { step: "naming", violations: [{ rule: "name.count", message: "expected 3, got 1" }] },
        promptVersions: { naming: "abc123def456" },
        usage: zeroUsage(),
        qualityRetries: 1,
        transportRetries: 0,
        latencyMs: 800,
        steps: [stepRecord(), stepRecord({ attempt: 2 })],
      };

      const ids = await store.finishRun(record);
      expect(ids).toBeUndefined();

      const { rows } = await testPool.query<{ status: string; failure: unknown }>("select status, failure from runs where id = $1", [
        runId,
      ]);
      expect(rows[0].status).toBe("rejected");
      expect(rows[0].failure).toEqual({ step: "naming", violations: [{ rule: "name.count", message: "expected 3, got 1" }] });

      const { rows: productRows } = await testPool.query("select 1 from products where run_id = $1", [runId]);
      expect(productRows).toHaveLength(0);
    });

    it("persists an error run's failure shape", async () => {
      const runId = await store.startRun(newRun());
      const record: FinishedRun = {
        runId,
        status: "error",
        failure: { step: "packaging", error: "provider_error", message: "503 from Gemini" },
        promptVersions: { naming: "abc123def456", tagline_description: "def456abc123", packaging: "112233445566" },
        usage: zeroUsage(),
        qualityRetries: 0,
        transportRetries: 2,
        latencyMs: 4000,
        steps: [],
      };

      await store.finishRun(record);

      const { rows } = await testPool.query<{ status: string; failure: unknown }>("select status, failure from runs where id = $1", [
        runId,
      ]);
      expect(rows[0].status).toBe("error");
      expect(rows[0].failure).toEqual({ step: "packaging", error: "provider_error", message: "503 from Gemini" });
    });

    it("rolls back the whole transaction if any part of it fails, leaving no partial writes", async () => {
      const runId = await store.startRun(newRun());
      const record: FinishedRun = {
        runId,
        status: "succeeded",
        content: {
          brandName: "Ridge",
          toneNotes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] },
          tagline: "Built for the trail",
          description: "A steel bottle for hikers.",
          packaging: { headline: "Ridge water bottle", body: "Steel build.", callouts: ["Durable", "Insulated"] },
          feasibilitySnapshot: {
            material: "Stainless Steel",
            materialTerms: ["steel"],
            costLow: 3.2,
            costHigh: 4.8,
            currency: "USD",
            moq: 500,
            leadTimeDaysLow: 35,
            leadTimeDaysHigh: 50,
            assumptions: "test fixture",
          },
        },
        nameCandidates: [{ name: "Ridge", rationale: "short", passed: true, violations: [] }],
        promptVersions: { naming: "abc123def456" },
        usage: { promptTokens: 10, candidatesTokens: 20, thoughtsTokens: 5, totalTokens: 35 },
        qualityRetries: 0,
        transportRetries: 0,
        latencyMs: 1200,
        steps: [stepRecord()],
      };

      await store.finishRun(record); // succeeds — one product row now exists for this run

      // products.run_id is unique — finishing the same run a second time hits that constraint
      // partway through the transaction (after the run_steps insert), so this must roll back
      // the second attempt's run_steps insert too, not just fail on the product insert alone.
      await expect(store.finishRun({ ...record, steps: [stepRecord({ attempt: 2 })] })).rejects.toThrow();

      const { rows: stepRows } = await testPool.query("select attempt from run_steps where run_id = $1 order by attempt", [runId]);
      expect(stepRows.map((row) => row.attempt)).toEqual([1]); // the second attempt's row never stuck

      const { rows: productRows } = await testPool.query("select id from products where run_id = $1", [runId]);
      expect(productRows).toHaveLength(1); // no duplicate product from the failed second attempt
    });
  });

  describe("row level security", () => {
    it("is enabled on every table in the schema", async () => {
      const tables = ["categories", "feasibility_options", "brands", "products", "runs", "run_steps", "eval_runs", "eval_results"];
      const { rows } = await testPool.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)",
        [tables],
      );
      expect(rows).toHaveLength(tables.length);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
      }
    });
  });
});
