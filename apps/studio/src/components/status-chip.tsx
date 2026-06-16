// Compact production-state chip. Status stays quiet per the Production Scroll
// rule that counters and state never compete with artwork.

import type { EpisodeStatus } from "@/lib/project";

const LABELS: Record<EpisodeStatus, { text: string; tone: string }> = {
  invalid: { text: "Needs fixes", tone: "chip-danger" },
  draft: { text: "Draft", tone: "chip" },
  "in-progress": { text: "In progress", tone: "chip-accent" },
  lettered: { text: "Lettered", tone: "chip-ok" },
};

export function StatusChip({ status }: { status: EpisodeStatus }) {
  const { text, tone } = LABELS[status];
  return <span className={`chip ${tone}`}>{text}</span>;
}
