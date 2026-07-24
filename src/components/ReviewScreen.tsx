"use client";

import { useState } from "react";
import type { Entity, ExtractedPage } from "@/lib/types";
import EntityHighlightedText from "./EntityHighlightedText";
import PdfPreview from "./PdfPreview";

interface PdfExportStatus {
  verified: boolean;
  rasterizedPages: number[];
}

interface Props {
  fileName: string;
  pages: ExtractedPage[];
  entities: Entity[];
  originalBytes: ArrayBuffer;
  onToggleEntity: (id: string) => void;
  onAddManualEntity: (page: number, start: number, end: number, text: string) => void;
  onExportText: () => void;
  onExportPdf: () => void;
  exportingPdf: boolean;
  pdfExportStatus: PdfExportStatus | null;
}

export default function ReviewScreen({
  fileName,
  pages,
  entities,
  originalBytes,
  onToggleEntity,
  onAddManualEntity,
  onExportText,
  onExportPdf,
  exportingPdf,
  pdfExportStatus,
}: Props) {
  const [showPreview, setShowPreview] = useState(true);
  const acceptedCount = entities.filter((e) => e.accepted).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold">{fileName}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {acceptedCount} of {entities.length} detections will be redacted · {pages.length} page
            {pages.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              onClick={() => setShowPreview((v) => !v)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              {showPreview ? "Hide PDF preview" : "Preview PDF"}
            </button>
            <button
              onClick={onExportText}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              Download redacted text (.txt)
            </button>
            <button
              onClick={onExportPdf}
              disabled={exportingPdf}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              {exportingPdf ? "Redacting & verifying…" : "Download redacted PDF"}
            </button>
          </div>
          {pdfExportStatus && (
            <p
              className={`text-xs ${
                pdfExportStatus.verified
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-700 dark:text-red-400"
              }`}
            >
              {pdfExportStatus.verified
                ? "✓ Verified: no original text is recoverable from the exported PDF"
                : "⚠ Verification could not confirm all original text was removed"}
              {pdfExportStatus.rasterizedPages.length > 0 &&
                ` (page${pdfExportStatus.rasterizedPages.length === 1 ? "" : "s"} ${pdfExportStatus.rasterizedPages.join(", ")} flattened to an image to guarantee this)`}
              .
            </p>
          )}
        </div>
      </div>

      {showPreview && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Live preview of the redacted PDF - updates automatically as you toggle or add redactions below.
          </p>
          <PdfPreview originalBytes={originalBytes} entities={entities} />
        </div>
      )}

      {pages.map((page) => {
        const pageEntities = entities.filter((e) => e.page === page.page);
        return (
          <div key={page.page} className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
              Page {page.page}
              {page.isOcr && (
                <span className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-normal text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  OCR
                </span>
              )}
            </h3>
            <EntityHighlightedText
              text={page.text}
              entities={pageEntities}
              onToggleEntity={onToggleEntity}
              onAddManualEntity={(start, end, text) => onAddManualEntity(page.page, start, end, text)}
            />
          </div>
        );
      })}
    </div>
  );
}
