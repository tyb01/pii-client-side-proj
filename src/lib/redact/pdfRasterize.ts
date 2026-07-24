import { PDFDocument, PDFPage, PDFName, PDFArray, PDFRef } from "pdf-lib";
import { loadPdfDocument, renderPageToCanvas } from "@/lib/pdf/extract";

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to rasterize page to PNG"));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, "image/png");
  });
}

/** Renders one page of a (already visually-redacted) PDF to a PNG, for the rasterization fallback. */
export async function renderPageAsPng(pdfBytes: Uint8Array, pageNum: number, scale = 2): Promise<Uint8Array> {
  const pdf = await loadPdfDocument(pdfBytes.slice());
  const canvas = await renderPageToCanvas(pdf, pageNum, scale);
  return canvasToPngBytes(canvas);
}

function deleteOldContentsObjects(pdfDoc: PDFDocument, page: PDFPage): void {
  const raw = page.node.get(PDFName.of("Contents"));
  if (!raw) return;
  if (raw instanceof PDFRef) {
    pdfDoc.context.delete(raw);
  } else if (raw instanceof PDFArray) {
    for (let i = 0; i < raw.size(); i++) {
      const el = raw.get(i);
      if (el instanceof PDFRef) pdfDoc.context.delete(el);
    }
  }
}

/**
 * Replaces a page's ENTIRE content with a single rasterized image — the
 * guaranteed-safe fallback for a page that text-stream surgery couldn't
 * confidently clear (composite/CID fonts, custom encodings, or anything the
 * verification pass still finds afterward). There is no text object left
 * on the page at all, so there is nothing left to extract.
 */
export async function rasterizePageInPlace(
  pdfDoc: PDFDocument,
  page: PDFPage,
  pngBytes: Uint8Array
): Promise<void> {
  const pngImage = await pdfDoc.embedPng(pngBytes);
  const { width, height } = page.getSize();

  deleteOldContentsObjects(pdfDoc, page);

  const xObjectName = page.node.newXObject("RedactedImage", pngImage.ref);
  const contentStr = `q\n${width} 0 0 ${height} 0 0 cm\n${xObjectName.asString()} Do\nQ`;
  const stream = pdfDoc.context.flateStream(new TextEncoder().encode(contentStr));
  const ref = pdfDoc.context.register(stream);
  page.node.set(PDFName.of("Contents"), ref);

  // Drop annotations too — an appearance stream on a lingering annotation
  // could in principle still carry text we didn't check.
  page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([]));
}
