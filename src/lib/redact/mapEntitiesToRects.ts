import type { Entity, ExtractedPage } from "@/lib/types";

/** Attaches draw-able rects to each entity from any page run whose char range overlaps it. */
export function attachRectsToEntities(page: ExtractedPage, entities: Entity[]): void {
  for (const entity of entities) {
    entity.rects = page.runs
      .filter((run) => run.start < entity.end && run.end > entity.start)
      .map((run) => run.rect);
  }
}
