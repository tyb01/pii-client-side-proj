"use client";

import type { Entity, ExtractedPage } from "@/lib/types";
import EntityHighlightedText from "./EntityHighlightedText";

const LEGEND: { source: Entity["source"]; label: string; swatch: string }[] = [
  { source: "regex", label: "Regex / checksum", swatch: "bg-blue-200 dark:bg-blue-900" },
  { source: "ner-gliner", label: "GLiNER (zero-shot)", swatch: "bg-purple-200 dark:bg-purple-900" },
  { source: "ner-piiranha", label: "Piiranha", swatch: "bg-orange-200 dark:bg-orange-900" },
  { source: "ner-distilbert", label: "DistilBERT", swatch: "bg-green-200 dark:bg-green-900" },
  { source: "manual", label: "Manual", swatch: "bg-red-200 dark:bg-red-900" },
];

interface PdfExportStatus {
  verified: boolean;
  rasterizedPages: number[];
}

interface Props {
  fileName: string;
  pages: ExtractedPage[];
  entities: Entity[];
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
  onToggleEntity,
  onAddManualEntity,
  onExportText,
  onExportPdf,
  exportingPdf,
  pdfExportStatus,
}: Props) {
  const acceptedCount = entities.filter((e) => e.accepted).length;
  const byLabel = new Map<string, number>();
  for (const e of entities) {
    if (!e.accepted) continue;
    byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold">{fileName}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {acceptedCount} of {entities.length} detections will be redacted · {pages.length} page
            {pages.length === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...byLabel.entries()].map(([label, count]) => (
              <span
                key={label}
                className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                {label}: {count}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
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

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600 dark:text-gray-400">
        <span className="font-medium">Legend:</span>
        {LEGEND.map((l) => (
          <span key={l.source} className="flex items-center gap-1">
            <span className={`h-3 w-3 rounded ${l.swatch}`} />
            {l.label}
          </span>
        ))}
        <span className="ml-auto italic">
          Click a highlight to toggle it · select text to add a manual redaction
        </span>
      </div>

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
