import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/adapters/pagination";

describe("cursor encode/decode", () => {
  it("round-trips a created_at and id", () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const cursor = encodeCursor({ createdAt, id: "abc-123" });
    expect(decodeCursor(cursor)).toEqual({ createdAt, id: "abc-123" });
  });

  it("is opaque (not human-readable as-is)", () => {
    const cursor = encodeCursor({ createdAt: new Date(), id: "abc-123" });
    expect(cursor).not.toContain("abc-123");
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(decodeCursor("not-a-real-cursor")).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null when the decoded value has no id after the separator", () => {
    const noId = Buffer.from("2026-01-01T00:00:00.000Z|", "utf8").toString("base64url");
    expect(decodeCursor(noId)).toBeNull();
  });

  it("returns null when the decoded created_at isn't a valid date", () => {
    const badDate = Buffer.from("not-a-date|abc-123", "utf8").toString("base64url");
    expect(decodeCursor(badDate)).toBeNull();
  });
});
