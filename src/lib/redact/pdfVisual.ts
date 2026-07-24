import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import type { Entity, PdfRect } from "@/lib/types";
import { redactPageTextInPlace } from "./pdfTextSurgery";
import { findPagesWithResidualText } from "./verifyRedaction";
import { renderPageAsPng, rasterizePageInPlace } from "./pdfRasterize";

const RECT_PADDING_PTS = 1.5;

export interface RedactedPdfResult {
  bytes: Uint8Array;
  /** True if a post-redaction re-extraction found no residual PII text anywhere. */
  verified: boolean;
  /** Pages that couldn't be safely handled by text-stream surgery and were rasterized instead. */
  rasterizedPages: number[];
}

function unionRect(rects: PdfRect[]): PdfRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { page: rects[0].page, x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
 * Produces a redacted PDF where PII is actually removed from the page —
 * no visual box, just blank space where the text used to be:
 *
 *  1. Blank the matching bytes directly in each page's content stream (see
 *     pdfTextSurgery.ts) so the original glyphs are never drawn at all —
 *     a best-effort pass, safe for the common case of simple/standard-
 *     encoded fonts.
 *  2. Re-extract the result with pdf.js and check whether any target
 *     string is still recoverable, page by page.
 *  3. Any page that still fails gets a black box drawn over the
 *     still-present entities — the ONLY place a box is ever drawn, purely
 *     to hide pixels the byte-level surgery couldn't reach — and is then
 *     rasterized to a flattened image, so nothing can be extracted or
 *     read off it at all.
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
  }

  let bytes = await pdfDoc.save();

  const targetsByPage = new Map<number, string[]>();
  for (const [pageNum, list] of entitiesByPage) targetsByPage.set(pageNum, list.map((e) => e.text));

  let residualPages = await findPagesWithResidualText(bytes, targetsByPage);
  const rasterizedPages: number[] = [];

  if (residualPages.size > 0) {
    for (const pageNum of residualPages) {
      const page = pages[pageNum - 1];
      if (!page) continue;

      // Surgery didn't fully blank this page's text, so the original
      // glyphs are still drawn — cover them before rendering so the
      // flattened image below never captures readable PII pixels.
      for (const entity of entitiesByPage.get(pageNum) ?? []) {
        const rect = unionRect(entity.rects);
        if (rect) drawRedactionBox(page, rect);
      }

      const preRasterBytes = await pdfDoc.save();
      const pngBytes = await renderPageAsPng(preRasterBytes, pageNum);
      await rasterizePageInPlace(pdfDoc, page, pngBytes);
      rasterizedPages.push(pageNum);
    }
    bytes = await pdfDoc.save();
    residualPages = await findPagesWithResidualText(bytes, targetsByPage);
  }

  return { bytes, verified: residualPages.size === 0, rasterizedPages };
}
