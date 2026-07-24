import { loadPdfDocument, extractPageText, looksLikeScannedPage } from "@/lib/pdf/extract";
import { ocrPage } from "@/lib/ocr/runOcr";
import { attachRectsToEntities } from "@/lib/redact/mapEntitiesToRects";
import { expandEntitiesToAllOccurrences } from "@/lib/redact/expandOccurrences";
import type { ExtractedPage, Entity, PipelineProgress, RedactionProvider } from "@/lib/types";

export interface PipelineResult {
  fileName: string;
  originalBytes: ArrayBuffer;
  pages: ExtractedPage[];
  entities: Entity[];
}

/**
 * Runs layers 1-4 end to end for one uploaded PDF: pdf.js text extraction,
 * OCR fallback for scanned pages, PII detection via the given provider, and
 * rect-mapping for visual redaction. Returns everything the review screen
 * and exporters need.
 */
export async function runPipeline(
  file: File,
  provider: RedactionProvider,
  onProgress: (progress: PipelineProgress) => void
): Promise<PipelineResult> {
  onProgress({ stage: "loading-pdf" });
  const originalBytes = await file.arrayBuffer();
  // pdf.js takes ownership of (and may detach) the buffer it's given, so it
  // gets a copy — `originalBytes` must survive intact for visual redaction.
  const pdf = await loadPdfDocument(originalBytes.slice(0));

  const totalPages = pdf.numPages;
  const pages: ExtractedPage[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress({ stage: "extracting-text", page: pageNum, totalPages });
    let extracted = await extractPageText(pdf, pageNum);

    if (looksLikeScannedPage(extracted)) {
      extracted = await ocrPage(pdf, pageNum, (fraction) =>
        onProgress({
          stage: "ocr",
          page: pageNum,
          totalPages,
          detail: `OCR ${Math.round(fraction * 100)}%`,
        })
      );
    }

    pages.push(extracted);
  }

  const entities: Entity[] = [];
  for (const page of pages) {
    onProgress({ stage: "detecting", page: page.page, totalPages });
    const pageEntities = await provider.detect(page.text, page.page);
    attachRectsToEntities(page, pageEntities);
    entities.push(...pageEntities);
  }

  // A name/MRN/accession number flagged once is still PII everywhere else
  // it appears — expand to every other occurrence across the whole document.
  const occurrences = expandEntitiesToAllOccurrences(pages, entities);
  for (const page of pages) {
    const pageOccurrences = occurrences.filter((o) => o.page === page.page);
    if (pageOccurrences.length > 0) attachRectsToEntities(page, pageOccurrences);
  }
  entities.push(...occurrences);

  onProgress({ stage: "done" });

  return { fileName: file.name, originalBytes, pages, entities };
}
