import type { Violation } from "@/lib/contracts/violation";

// Fills the `{{retry_feedback}}` placeholder every agent's system prompt ends with (TRD.md §5
// "Prompt construction") — "" on the first attempt, this rendering of the failed rules on the
// quality retry (D11).
export function renderRetryFeedback(violations: Violation[]): string {
  if (violations.length === 0) return "";
  const list = violations.map((violation) => `- ${violation.rule}: ${violation.message}`).join("\n");
  return `\nYour previous attempt failed these checks — fix them this time:\n${list}`;
}
