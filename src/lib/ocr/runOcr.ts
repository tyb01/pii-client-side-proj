import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ExtractedPage, PositionedRun } from "@/lib/types";
import { renderPageToCanvas } from "@/lib/pdf/extract";
import { preprocessForOcr } from "./preprocess";

const OCR_RENDER_SCALE = 2; // higher DPI improves recognition accuracy on scanned/faxed pages

// Loaded from jsDelivr so we don't have to solve webpack bundling for the
// worker/wasm/traineddata assets ourselves. Only Tesseract's own code and
// language model are fetched this way — the document image never leaves
// the browser.
const TESS_CDN_BASE = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js";
const TESS_CORE_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1";
const TESS_LANG_CDN = "https://tessdata.projectnaptha.com/4.0.0";

let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(onProgress?: (progress: number) => void): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      workerPath: TESS_CDN_BASE,
      corePath: TESS_CORE_CDN,
      langPath: TESS_LANG_CDN,
      logger: (m) => {
        if (m.status === "recognizing text" && onProgress) onProgress(m.progress);
      },
    });
  }
  return workerPromise;
}

export async function terminateOcrWorker() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

export async function ocrPage(
  pdf: PDFDocumentProxy,
  pageNum: number,
  onProgress?: (progress: number) => void
): Promise<ExtractedPage> {
  const page = await pdf.getPage(pageNum);
  const viewportPts = page.getViewport({ scale: 1 });
  const rawCanvas = await renderPageToCanvas(pdf, pageNum, OCR_RENDER_SCALE);
  const { canvas: preprocessed } = preprocessForOcr(rawCanvas);

  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(preprocessed);

  let text = "";
  const runs: PositionedRun[] = [];
  let prevLine: unknown = null;

  for (const word of data.words) {
    if (prevLine !== null) {
      text += prevLine !== word.line ? "\n" : " ";
    }
    prevLine = word.line;

    const start = text.length;
    text += word.text;
    const end = text.length;

    const { x0, y0, x1, y1 } = word.bbox;
    runs.push({
      text: word.text,
      start,
      end,
      rect: {
        page: pageNum,
        x: x0 / OCR_RENDER_SCALE,
        y: viewportPts.height - y1 / OCR_RENDER_SCALE,
        width: (x1 - x0) / OCR_RENDER_SCALE,
        height: (y1 - y0) / OCR_RENDER_SCALE,
      },
    });
  }

  page.cleanup();

  return {
    page: pageNum,
    text,
    isOcr: true,
    runs,
    widthPts: viewportPts.width,
    heightPts: viewportPts.height,
  };
}
