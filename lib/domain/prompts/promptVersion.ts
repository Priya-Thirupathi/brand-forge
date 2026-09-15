import { createHash } from "node:crypto";

// D17: a prompt's version is the first 12 hex chars of sha256(system template + user template
// + JSON schema). Computed once from the static template text and schema shape, not from a
// rendered call — it changes only when the prompt or schema itself changes, never per-run.
export function computePromptVersion(system: string, user: string, jsonSchema: unknown): string {
  const hash = createHash("sha256");
  hash.update(system);
  hash.update(user);
  hash.update(JSON.stringify(jsonSchema));
  return hash.digest("hex").slice(0, 12);
}
