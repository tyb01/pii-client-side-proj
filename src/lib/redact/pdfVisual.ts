import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { Entity, PdfRect } from "@/lib/types";
import { buildPlaceholderMap, placeholderKeyFor } from "./placeholderMap";
import { redactPageTextInPlace } from "./pdfTextSurgery";
import { findPagesWithResidualText } from "./verifyRedaction";
import { renderPageAsPng, rasterizePageInPlace } from "./pdfRasterize";

const RECT_PADDING_PTS = 1.5;
const MIN_LABEL_FONT_SIZE = 4;
const MAX_LABEL_FONT_SIZE = 10;

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

/** Draws the placeholder label in white over the black box, shrinking to fit if needed. */
function drawPlaceholderLabel(page: PDFPage, font: PDFFont, rect: PdfRect, label: string): void {
  let size = Math.min(MAX_LABEL_FONT_SIZE, Math.max(MIN_LABEL_FONT_SIZE, rect.height * 0.7));
  while (size > MIN_LABEL_FONT_SIZE && font.widthOfTextAtSize(label, size) > rect.width - 2) {
    size -= 0.5;
  }
  if (font.widthOfTextAtSize(label, size) > rect.width - 2 && size <= MIN_LABEL_FONT_SIZE) {
    return; // box is too small for any legible label — the black box alone still redacts it
  }
  page.drawText(label, {
    x: rect.x + Math.max(0, (rect.width - font.widthOfTextAtSize(label, size)) / 2),
    y: rect.y + Math.max(0, (rect.height - size) / 2),
    size,
    font,
    color: rgb(1, 1, 1),
  });
}

/**
 * Produces a redacted PDF where PII is actually removed from the text
 * layer, not just covered by a drawn box:
 *
 *  1. Draw a black box + a placeholder label (e.g. "PATIENT_NAME_1", using
 *     the SAME mapping as the text export) over every accepted entity.
 *  2. Attempt to blank the matching bytes directly in each page's content
 *     stream (see pdfTextSurgery.ts) — a best-effort pass, safe for the
 *     common case of simple/standard-encoded fonts.
 *  3. Re-extract the result with pdf.js and check whether any target
 *     string is still recoverable, page by page.
 *  4. Any page that still fails is rasterized to a flattened image — at
 *     that point there is no text object left on the page at all, so
 *     nothing can be extracted from it, guaranteed.
 *
 * `verified` reflects a final re-check after step 4 and should always be
 * true; it's returned so the caller can surface an honest result either way
 * rather than silently asserting safety.
 */
export async function buildRedactedPdf(
  originalBytes: ArrayBuffer,
  entities: Entity[]
): Promise<RedactedPdfResult> {
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const placeholderMap = buildPlaceholderMap(entities);

  const entitiesByPage = new Map<number, Entity[]>();
  for (const entity of entities) {
    if (!entity.accepted) continue;
    if (!entitiesByPage.has(entity.page)) entitiesByPage.set(entity.page, []);
    entitiesByPage.get(entity.page)!.push(entity);
  }

  for (const [pageNum, pageEntities] of entitiesByPage) {
    const page = pages[pageNum - 1];
    if (!page) continue;

    for (const entity of pageEntities) {
      const rect = unionRect(entity.rects);
      if (!rect) continue;
      const label = placeholderMap.get(placeholderKeyFor(entity)) ?? `[${entity.label}]`;
      drawRedactionBox(page, rect);
      drawPlaceholderLabel(page, font, rect, label);
    }

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
      const pngBytes = await renderPageAsPng(bytes, pageNum);
      await rasterizePageInPlace(pdfDoc, page, pngBytes);
      rasterizedPages.push(pageNum);
    }
    bytes = await pdfDoc.save();
    residualPages = await findPagesWithResidualText(bytes, targetsByPage);
  }

  return { bytes, verified: residualPages.size === 0, rasterizedPages };
}
