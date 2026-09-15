// TRD.md §7 "Normalization before matching": NFKC, lowercase, strip diacritics, punctuation
// and hyphens become word boundaries. Single words match whole words; multi-word entries
// match as whole phrases — both fall out of the same whole-word-boundary regex once
// punctuation/hyphens are turned into spaces (e.g. "plastic-free" normalizes to the two-word
// phrase "plastic free").

export function normalizeForMatching(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word (single term) or whole-phrase (multi-word term) match, never a substring match —
// this is what keeps "classic" from matching a banned term like "class".
export function containsWholeTerm(haystack: string, term: string): boolean {
  const normalizedTerm = normalizeForMatching(term);
  if (!normalizedTerm) return false;
  const normalizedHaystack = normalizeForMatching(haystack);
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}(\\s|$)`);
  return pattern.test(normalizedHaystack);
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}
