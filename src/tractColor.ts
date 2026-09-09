import type { Tract } from "./types";

/* Per-tract colour.

   The engine draws a tract in its role's colour unless the call sheet sets an
   optional `color`. These are the same role colours as ROLE_STYLE in
   scripts/deedplot.py -- mirrored here only so a picker can show the default it
   would otherwise inherit. The engine stays the authority: it reports the
   colour it actually used on each tract of a plot result. */

export const ROLE_COLORS: Record<string, string> = {
  subject: "#1f4e79",
  easement: "#b7472a",
  exception: "#7f7f7f",
  adjoiner: "#548235",
  parent: "#7030a0",
  other: "#404040",
};

export function roleColor(role: string | undefined) {
  return ROLE_COLORS[String(role ?? "subject").toLowerCase()] ?? ROLE_COLORS.other;
}

/** The colour a tract will be drawn in: its own, or its role's. */
export function effectiveColor(tract: Tract) {
  const own = typeof tract.color === "string" ? tract.color.trim() : "";
  return /^#[0-9a-fA-F]{6}$/.test(own) ? own : roleColor(tract.role as string);
}
