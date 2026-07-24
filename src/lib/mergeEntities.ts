import type { EntityDraft } from "@/lib/regex/recognize";
import type { EntitySource } from "@/lib/types";

// Regex/checksum hits are deterministic and near-100% precision, so they win
// over any ML guess on the same span. Manual review edits win over everything.
const SOURCE_PRIORITY: Record<EntitySource, number> = {
  manual: 100,
  regex: 90,
  "ner-gliner": 70,
  "ner-piiranha": 60,
  "ner-distilbert": 50,
};

/** Drops lower-priority entities whose span overlaps a higher-priority one. */
export function mergeEntityDrafts(drafts: EntityDraft[]): EntityDraft[] {
  const sorted = [...drafts].sort(
    (a, b) => a.start - b.start || SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]
  );

  const kept: EntityDraft[] = [];
  for (const draft of sorted) {
    const overlapIndex = kept.findIndex((k) => draft.start < k.end && draft.end > k.start);
    if (overlapIndex === -1) {
      kept.push(draft);
      continue;
    }
    if (SOURCE_PRIORITY[draft.source] > SOURCE_PRIORITY[kept[overlapIndex].source]) {
      kept[overlapIndex] = draft;
    }
  }

  return kept.sort((a, b) => a.start - b.start);
}
