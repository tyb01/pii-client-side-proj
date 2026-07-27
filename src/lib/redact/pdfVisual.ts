import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import type { Entity, PdfRect } from "@/lib/types";
import { redactPageTextInPlace } from "./pdfTextSurgery";
import { findResidualValuesByPage } from "./verifyRedaction";
import { renderPageAsPng, rasterizePageInPlace } from "./pdfRasterize";

const RECT_PADDING_PTS = 1.5;

export interface RedactedPdfResult {
  bytes: Uint8Array;
  /** True if a post-redaction re-extraction found no residual PII text anywhere. */
  verified: boolean;
  /** Pages that couldn't be safely handled by text-stream surgery and were rasterized instead. */
  rasterizedPages: number[];
}

function drawRedactionBox(page: PDFPage, rect: PdfRect): void {
  page.drawRectangle({
    x: rect.x - RECT_PADDING_PTS,
    y: rect.y - RECT_PADDING_PTS,
    width: rect.width + RECT_PADDING_PTS * 2,
    height: rect.height + RECT_PADDING_PTS * 2,
    color: rgb(0, 0, 0),
  });
}

/**
 * Produces a redacted PDF where PII is both actually removed from the page
 * AND visibly covered by a black box, in every case:
 *
 *  1. Blank the matching bytes directly in each page's content stream (see
 *     pdfTextSurgery.ts) so the original glyphs are never drawn at all —
 *     a best-effort pass, safe for the common case of simple/standard-
 *     encoded fonts.
 *  2. Draw a black box over every accepted entity's location on that page,
 *     unconditionally — a consistent visible marker regardless of whether
 *     surgery succeeded, not just a fallback for when it didn't.
 *  3. Re-extract the result with pdf.js and check exactly which target
 *     values are STILL recoverable despite the box (i.e. surgery failed to
 *     blank them) — a box alone only covers the pixels, the original text
 *     is still selectable/extractable underneath it. Any such page is
 *     rasterized to a flattened image, so nothing can be extracted at all;
 *     the box already drawn on it comes along for the ride.
 *
 * `verified` reflects a final re-check after step 3 and should always be
 * true; it's returned so the caller can surface an honest result either way
 * rather than silently asserting safety.
 */
export async function buildRedactedPdf(
  originalBytes: ArrayBuffer,
  entities: Entity[]
): Promise<RedactedPdfResult> {
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();

  const entitiesByPage = new Map<number, Entity[]>();
  for (const entity of entities) {
    if (!entity.accepted) continue;
    if (!entitiesByPage.has(entity.page)) entitiesByPage.set(entity.page, []);
    entitiesByPage.get(entity.page)!.push(entity);
  }

  for (const [pageNum, pageEntities] of entitiesByPage) {
    const page = pages[pageNum - 1];
    if (!page) continue;

    // Best-effort real text removal — see pdfTextSurgery.ts for what this
    // can and can't safely handle. Never let a surgery failure on one page
    // (a pdf-lib object-graph quirk, a font we can't parse, etc.) abort the
    // whole export — the verification pass below will catch and rasterize
    // whatever this didn't manage to redact.
    try {
      redactPageTextInPlace(
        pdfDoc,
        page,
        pageEntities.map((e) => e.text)
      );
    } catch (err) {
      console.warn(`Text-stream redaction failed for page ${pageNum}, will rely on verification/rasterization:`, err);
    }

    // One box per rect (not a single bounding box across all of them): an
    // entity spanning a line wrap has one rect per line, and unioning those
    // would draw one oversized box across everything in between.
    for (const entity of pageEntities) {
      for (const rect of entity.rects) drawRedactionBox(page, rect);
    }
  }

  let bytes = await pdfDoc.save();

  const targetsByPage = new Map<number, string[]>();
  for (const [pageNum, list] of entitiesByPage) targetsByPage.set(pageNum, list.map((e) => e.text));

  let residualByPage = await findResidualValuesByPage(bytes, targetsByPage);
  const rasterizedPages: number[] = [];

  if (residualByPage.size > 0) {
    for (const pageNum of residualByPage.keys()) {
      const page = pages[pageNum - 1];
      if (!page) continue;

      // Surgery didn't fully blank this page's text — the black box drawn
      // above only covers the pixels, the original text is still
      // extractable underneath it, so flatten to an image to guarantee
      // nothing can be recovered. The box is already part of the page's
      // content, so it's captured in the render below.
      const preRasterBytes = await pdfDoc.save();
      const pngBytes = await renderPageAsPng(preRasterBytes, pageNum);
      await rasterizePageInPlace(pdfDoc, page, pngBytes);
      rasterizedPages.push(pageNum);
    }
    bytes = await pdfDoc.save();
    residualByPage = await findResidualValuesByPage(bytes, targetsByPage);
  }

  return { bytes, verified: residualByPage.size === 0, rasterizedPages };
}
