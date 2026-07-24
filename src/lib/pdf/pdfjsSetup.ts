import * as pdfjsLib from "pdfjs-dist";

let configured = false;

/** Points pdf.js at the worker file copied into /public (see scripts/copy-pdf-worker.mjs). */
export function ensurePdfWorkerConfigured() {
  if (configured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  configured = true;
}

export { pdfjsLib };
