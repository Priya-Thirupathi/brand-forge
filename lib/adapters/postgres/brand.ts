import type { Pool } from "pg";
import type { ToneNotes } from "@/lib/domain/agents/taglineDescription";

export interface FollowUpBrand {
  id: string;
  name: string;
  toneNotes: ToneNotes;
}

// Stage 5, item 2 (D29): a follow-up product reuses an existing, visible brand's name and
// tone_notes. Hidden brands (moderation) can't be followed — same visibility rule the gallery
// already applies (lib/adapters/postgres/gallery.ts) — but any source (user, seed) is
// followable, matching what the gallery itself already shows without distinction.
export async function loadFollowUpBrand(pool: Pool, brandId: string): Promise<FollowUpBrand | null> {
  const { rows } = await pool.query<{ id: string; name: string; tone_notes: ToneNotes }>(
    `select id, name, tone_notes from brands where id = $1 and hidden = false`,
    [brandId],
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.name, toneNotes: row.tone_notes } : null;
}
