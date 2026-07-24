import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { ensurePdfWorkerConfigured, pdfjsLib } from "./pdfjsSetup";
import type { ExtractedPage, PositionedRun } from "@/lib/types";

/** Pages with less real text than this are treated as scanned images and routed to OCR. */
const MIN_CHARS_FOR_DIGITAL_TEXT = 20;

export async function loadPdfDocument(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  ensurePdfWorkerConfigured();
  const loadingTask = pdfjsLib.getDocument({ data });
  return loadingTask.promise;
}

/**
 * Extracts plain text plus per-run rectangles for one page. Runs and their
 * [start,end) offsets are built from the SAME concatenation used for `text`,
 * so downstream char-offset entities always map back to the correct rects
 * regardless of how visual PDF spacing actually looked.
 */
export async function extractPageText(
  pdf: PDFDocumentProxy,
  pageNum: number
): Promise<ExtractedPage> {
  const page: PDFPageProxy = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  let text = "";
  const runs: PositionedRun[] = [];

  for (const item of content.items) {
    if (!("str" in item)) continue; // TextMarkedContent entries carry no position info
    const str = item.str;
    if (str.length > 0) {
      const start = text.length;
      text += str;
      const end = text.length;
      const [, , c, d, e, f] = item.transform;
      runs.push({
        text: str,
        start,
        end,
        rect: {
          page: pageNum,
          x: e,
          y: f,
          width: item.width,
          height: item.height || Math.hypot(c, d) || 10,
        },
      });
    }
    if (item.hasEOL) {
      text += "\n";
    } else if (str.length > 0) {
      text += " ";
    }
  }

  page.cleanup();

  return {
    page: pageNum,
    text,
    isOcr: false,
    runs,
    widthPts: viewport.width,
    heightPts: viewport.height,
  };
}

export function looksLikeScannedPage(extracted: ExtractedPage): boolean {
  return extracted.text.replace(/\s/g, "").length < MIN_CHARS_FOR_DIGITAL_TEXT;
}

export async function renderPageToCanvas(
  pdf: PDFDocumentProxy,
  pageNum: number,
  scale: number
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}
