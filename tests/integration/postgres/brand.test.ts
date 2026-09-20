import { beforeEach, describe, expect, it } from "vitest";
import { loadFollowUpBrand } from "@/lib/adapters/postgres/brand";
import { resetDb, testPool } from "../setup/testDb";

beforeEach(async () => {
  await resetDb();
});

async function insertBrand(overrides: { hidden?: boolean } = {}): Promise<string> {
  const { rows } = await testPool.query<{ id: string }>(
    `insert into brands (name, tone_notes, source, hidden)
     values ('Ridge', '{"voice":["bold"],"audience":"hikers","personality":"rugged","avoid":[]}'::jsonb, 'user', $1)
     returning id`,
    [overrides.hidden ?? false],
  );
  return rows[0].id;
}

describe("loadFollowUpBrand", () => {
  it("returns the brand's name and tone_notes", async () => {
    const brandId = await insertBrand();
    const brand = await loadFollowUpBrand(testPool, brandId);
    expect(brand).toEqual({
      id: brandId,
      name: "Ridge",
      toneNotes: { voice: ["bold"], audience: "hikers", personality: "rugged", avoid: [] },
    });
  });

  it("returns null for a hidden brand", async () => {
    const brandId = await insertBrand({ hidden: true });
    expect(await loadFollowUpBrand(testPool, brandId)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await loadFollowUpBrand(testPool, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
