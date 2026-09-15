import type { Violation } from "@/lib/contracts/violation";
import { BANNED_WORDS } from "@/config/bannedWords";
import { containsWholeTerm } from "./normalize";

const PLACEHOLDER_PATTERNS = [
  /\[[^\]]*\]/,
  /\{[^}]*\}/,
  /<[^>]*>/,
  /lorem ipsum/i,
  /\bbrand name\b/i,
  /\bproduct name\b/i,
];

function collectStrings(value: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") {
    out.push({ path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectStrings(nested, path ? `${path}.${key}` : key, out);
    }
  }
}

// output.nonempty, output.placeholder, output.banned_word (TRD.md §7) — applied to every
// string field of any agent's parsed output, generically. output.schema and output.safety
// aren't domain rules: schema validity is enforced by Zod parsing before evaluate() ever
// runs, and safety is a property of Gemini's response metadata, not the parsed JSON.
export function checkGenericOutputRules(output: object): Violation[] {
  const strings: { path: string; text: string }[] = [];
  collectStrings(output, "", strings);
  const violations: Violation[] = [];

  for (const { path, text } of strings) {
    if (text.trim() === "") {
      violations.push({ rule: "output.nonempty", message: `${path} is empty` });
      continue;
    }
    if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) {
      violations.push({
        rule: "output.placeholder",
        message: `${path} looks like an unfilled placeholder: "${text}"`,
      });
    }
    for (const word of BANNED_WORDS) {
      if (containsWholeTerm(text, word)) {
        violations.push({ rule: "output.banned_word", message: `${path} contains a banned word` });
      }
    }
  }

  return violations;
}
