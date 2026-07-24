import type { Entity, ExtractedPage, PdfRect, PositionedRun } from "@/lib/types";

/**
 * Attaches draw-able rects to each entity. A `run` is one pdf.js text item,
 * which frequently spans an entire line (many PDF generators — including
 * HTML-to-PDF export tools — draw a whole line as one string) rather than
 * just one word. Using the run's rect as-is would size the redaction box
 * (drawn only as the rasterization-fallback safety net, see pdfVisual.ts)
 * to the WHOLE line/run even when the entity is a short substring within
 * it. Slicing a horizontal sub-rect proportional to the entity's character
 * overlap within the run keeps the box roughly sized to just the matched
 * value instead — an approximation (it assumes uniform character width
 * within the run), not pixel-perfect, but far tighter than the whole run.
 */
export function attachRectsToEntities(page: ExtractedPage, entities: Entity[]): void {
  for (const entity of entities) {
    entity.rects = page.runs
      .filter((run) => run.start < entity.end && run.end > entity.start)
      .map((run) => sliceRunRect(run, entity));
  }
}

function sliceRunRect(run: PositionedRun, entity: Entity): PdfRect {
  const runLength = run.end - run.start;
  if (runLength <= 0) return run.rect;

  const overlapStart = Math.max(entity.start, run.start);
  const overlapEnd = Math.min(entity.end, run.end);
  const fracStart = (overlapStart - run.start) / runLength;
  const fracEnd = (overlapEnd - run.start) / runLength;

  return {
    ...run.rect,
    x: run.rect.x + fracStart * run.rect.width,
    width: (fracEnd - fracStart) * run.rect.width,
  };
}
