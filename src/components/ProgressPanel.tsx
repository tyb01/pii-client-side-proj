"use client";

import type { PipelineProgress } from "@/lib/types";
import type { NerLoadProgress } from "@/lib/ner";

const STAGE_LABELS: Record<PipelineProgress["stage"], string> = {
  "loading-pdf": "Loading PDF…",
  "extracting-text": "Extracting text",
  ocr: "Running OCR on scanned page",
  "loading-model": "Loading detection model",
  detecting: "Detecting PII",
  done: "Done",
};

interface Props {
  progress: PipelineProgress | null;
  modelProgress: NerLoadProgress | null;
}

export default function ProgressPanel({ progress, modelProgress }: Props) {
  if (!progress) return null;

  const pageInfo =
    progress.page && progress.totalPages ? ` (page ${progress.page} / ${progress.totalPages})` : "";

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-6 dark:border-gray-700">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900 dark:border-gray-700 dark:border-t-gray-100" />
        <span className="font-medium">
          {STAGE_LABELS[progress.stage]}
          {pageInfo}
        </span>
      </div>
      {progress.detail && <p className="text-sm text-gray-500 dark:text-gray-400">{progress.detail}</p>}
      {modelProgress && (
        <div>
          <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">{modelProgress.detail}</p>
          {modelProgress.progress !== undefined && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div
                className="h-full rounded-full bg-gray-900 transition-all dark:bg-gray-100"
                style={{ width: `${modelProgress.progress}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
