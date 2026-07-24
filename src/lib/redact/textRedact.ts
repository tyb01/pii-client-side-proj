import type { Entity } from "@/lib/types";

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
 * Deletes accepted entity spans outright — no placeholder token is left in
 * their place, just the surrounding text closed up. Nothing about the
 * redacted value (not even its label or that two mentions were the same
 * person) survives into this artifact.
 */
export function buildRedactedDocument(
  pages: { page: number; text: string; entities: Entity[] }[]
): RedactedDocument {
  const redactedPages: RedactedPage[] = pages.map(({ page, text, entities }) => {
    const accepted = [...entities]
      .filter((e) => e.accepted)
      .sort((a, b) => a.start - b.start);

    let result = "";
    let cursor = 0;
    for (const entity of accepted) {
      if (entity.start < cursor) continue; // overlapping with a previously applied entity
      result += text.slice(cursor, entity.start);
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
