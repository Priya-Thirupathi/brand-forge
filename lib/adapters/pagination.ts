// TRD.md §8: "opaque cursor over (created_at, id)" for /api/products and /api/runs. Base64 is
// just to make it inert as a query-string value — nothing about it is meant to be secret, so a
// client decoding it isn't a concern worth guarding against.
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separatorIndex = decoded.indexOf("|");
    if (separatorIndex === -1) return null;
    const createdAt = new Date(decoded.slice(0, separatorIndex));
    const id = decoded.slice(separatorIndex + 1);
    if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
