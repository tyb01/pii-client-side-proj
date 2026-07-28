import type { EntityDraft } from "@/lib/regex/recognize";
import type { EntitySource } from "@/lib/types";

// Regex/checksum hits are deterministic and near-100% precision, so they win
// over any ML guess on the same span. Manual review edits win over everything.
const SOURCE_PRIORITY: Record<EntitySource, number> = {
  manual: 100,
  regex: 90,
  "ner-openmed": 70,
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
    const existing = kept[overlapIndex];
    const draftPriority = SOURCE_PRIORITY[draft.source];
    const existingPriority = SOURCE_PRIORITY[existing.source];
    if (draftPriority > existingPriority) {
      kept[overlapIndex] = draft;
    } else if (draftPriority === existingPriority) {
      // Same source tier (e.g. two regex recognizers, like the generic
      // identifier catch-all overlapping a named one) — prefer whichever
      // captured the WIDER span. A narrower match here is exactly how a
      // field ends up only partially redacted (e.g. "Report ID:
      // ODX2213087" matched as just "ODX"): for a redaction tool, the more
      // complete span is always the safer one to keep, even at the cost
      // of a less-specific label. Only fall back to score when the widths
      // tie too.
      const draftLen = draft.end - draft.start;
      const existingLen = existing.end - existing.start;
      if (draftLen > existingLen || (draftLen === existingLen && draft.score > existing.score)) {
        kept[overlapIndex] = draft;
      }
    }
  }

  return kept.sort((a, b) => a.start - b.start);
}
