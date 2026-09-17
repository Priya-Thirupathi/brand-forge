import type { ReactNode } from "react";

// One pill treatment, reused everywhere a status/tag currently gets its own ad hoc classes
// (step progress, run status, outcome badges, gallery source tag) — same shape, same weight,
// only the color changes with meaning.
const VARIANT_STYLES = {
  neutral: "bg-line/60 text-muted",
  accent: "bg-accent-soft text-accent-soft-ink",
  success: "bg-success-soft text-success-soft-ink",
  warning: "bg-warning-soft text-warning-soft-ink",
  danger: "bg-danger-soft text-danger-soft-ink",
  info: "bg-info-soft text-info-soft-ink",
} as const;

export type BadgeVariant = keyof typeof VARIANT_STYLES;

export function Badge({ variant = "neutral", children }: { variant?: BadgeVariant; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_STYLES[variant]}`}>{children}</span>;
}
