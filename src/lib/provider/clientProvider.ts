import type { RedactionProvider, Entity } from "@/lib/types";
import { detectRegexEntities } from "@/lib/regex/recognize";
import { getBackend, type NerBackendId } from "@/lib/ner";
import { mergeEntityDrafts } from "@/lib/mergeEntities";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `entity-${idCounter}`;
}

// Only DOB is actually identifying on its own; report/collection/signing
// dates (and their time-of-day companions) are clinically necessary and
// shouldn't disappear. Sex/gender alone isn't identifying either and is
// clinically relevant (e.g. reference ranges), so it's excluded too. Age is
// the same story — a bare age number isn't identifying on its own and is
// clinically necessary (dosing, reference ranges, etc.), regardless of
// where it occurs (a standalone "Age:" field or the combined "DOB / Age /
// Sex: ... / 53 / ..." header — each piece is still its own AGE-labeled
// entity either way, only DOB itself should ever be redacted there).
// Filtered out entirely — same treatment as EXCLUDED_RAW_LABELS in
// openMedPostProcess.ts (occupation) — rather than kept-but-unaccepted:
// these never become a detection at all, so they don't show up in the
// review screen or the redaction count either.
const EXCLUDED_LABELS = new Set(["DATE", "TIME_OF_DAY", "COLLECTION_DATE", "GENDER", "AGE"]);

/**
 * The client-side implementation of RedactionProvider (see the architecture
 * note in the plan): detect(text) -> entities[], identical schema to the
 * server-side provider, so the review screen and downstream pipeline don't
 * need to know which mode ran. `nerBackendId` is null to run regex-only.
 */
export function createClientRedactionProvider(nerBackendId: NerBackendId | null): RedactionProvider {
  return {
    mode: "client",
    async detect(text: string, page: number): Promise<Entity[]> {
      const regexDrafts = detectRegexEntities(text);

      let nerDrafts: ReturnType<typeof detectRegexEntities> = [];
      if (nerBackendId) {
        const backend = getBackend(nerBackendId);
        if (backend.isLoaded()) {
          nerDrafts = await backend.detect(text);
        }
      }

      const merged = mergeEntityDrafts([...regexDrafts, ...nerDrafts]).filter(
        (draft) => !EXCLUDED_LABELS.has(draft.label)
      );

      return merged.map((draft) => ({
        ...draft,
        id: nextId(),
        page,
        accepted: true,
        rects: [],
      }));
    },
  };
}
