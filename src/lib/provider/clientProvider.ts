import type { RedactionProvider, Entity } from "@/lib/types";
import { detectRegexEntities } from "@/lib/regex/recognize";
import { getBackend, type NerBackendId } from "@/lib/ner";
import { mergeEntityDrafts } from "@/lib/mergeEntities";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `entity-${idCounter}`;
}

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

      const merged = mergeEntityDrafts([...regexDrafts, ...nerDrafts]);

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
