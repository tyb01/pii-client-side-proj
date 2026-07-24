import type { Entity, ExtractedPage } from "@/lib/types";

const MIN_OCCURRENCE_LENGTH = 3;

/**
 * PII redaction must cover every occurrence of a value, not just the first
 * one a detector happened to flag (a physician's name repeated in a header,
 * footer, and signature block is still the same PII each time). For every
 * accepted entity, this finds every other exact-text match anywhere in the
 * document and creates additional entities for them — all sharing the
 * source entity's label, so they resolve to the exact same placeholder in
 * `buildRedactedDocument`.
 */
export function expandEntitiesToAllOccurrences(
  pages: ExtractedPage[],
  entities: Entity[]
): Entity[] {
  const existingSpans = new Set(entities.map((e) => `${e.page}:${e.start}:${e.end}`));

  const templateByValue = new Map<string, Entity>();
  for (const entity of entities) {
    if (!entity.accepted) continue;
    const value = entity.text.trim();
    if (value.length < MIN_OCCURRENCE_LENGTH) continue;
    if (!templateByValue.has(value)) templateByValue.set(value, entity);
  }

  const additional: Entity[] = [];
  let counter = 0;

  for (const [value, template] of templateByValue) {
    for (const page of pages) {
      let searchFrom = 0;
      for (;;) {
        const idx = page.text.indexOf(value, searchFrom);
        if (idx === -1) break;
        const end = idx + value.length;
        searchFrom = idx + 1;

        const spanKey = `${page.page}:${idx}:${end}`;
        if (existingSpans.has(spanKey)) continue;
        existingSpans.add(spanKey);

        counter += 1;
        additional.push({
          id: `occurrence-${counter}`,
          start: idx,
          end,
          text: value,
          label: template.label,
          score: template.score,
          source: template.source,
          page: page.page,
          accepted: true,
          rects: [],
        });
      }
    }
  }

  return additional;
}
