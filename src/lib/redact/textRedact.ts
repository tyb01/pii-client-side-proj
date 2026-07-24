import type { Entity } from "@/lib/types";
import { buildPlaceholderMap, placeholderKeyFor } from "./placeholderMap";

export interface RedactedPage {
  page: number;
  redactedText: string;
}

export interface RedactedDocument {
  pages: RedactedPage[];
  /** All pages joined with a page-break marker — this is the artifact that leaves the device. */
  combinedText: string;
}

/**
 * Replaces accepted entity spans with placeholders like [PATIENT_NAME_1].
 * The SAME normalized (label + lowercased text) entity gets the SAME
 * placeholder everywhere it appears in the document (see placeholderMap.ts
 * — the visually-redacted PDF's on-page labels use the exact same mapping),
 * so a downstream LLM can still track "the same person" across pages
 * without ever seeing the real value.
 */
export function buildRedactedDocument(
  pages: { page: number; text: string; entities: Entity[] }[]
): RedactedDocument {
  const allEntities = pages.flatMap((p) => p.entities);
  const placeholderByKey = buildPlaceholderMap(allEntities);

  const redactedPages: RedactedPage[] = pages.map(({ page, text, entities }) => {
    const accepted = [...entities]
      .filter((e) => e.accepted)
      .sort((a, b) => a.start - b.start);

    let result = "";
    let cursor = 0;
    for (const entity of accepted) {
      if (entity.start < cursor) continue; // overlapping with a previously applied entity
      result += text.slice(cursor, entity.start);
      result += placeholderByKey.get(placeholderKeyFor(entity)) ?? `[${entity.label}]`;
      cursor = entity.end;
    }
    result += text.slice(cursor);

    return { page, redactedText: result };
  });

  return {
    pages: redactedPages,
    combinedText: redactedPages
      .map((p) => `--- Page ${p.page} ---\n${p.redactedText}`)
      .join("\n\n"),
  };
}
