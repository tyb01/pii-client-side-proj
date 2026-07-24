"use client";

import { useState } from "react";
import UploadPanel from "@/components/UploadPanel";
import ProgressPanel from "@/components/ProgressPanel";
import ReviewScreen from "@/components/ReviewScreen";
import { runPipeline, type PipelineResult } from "@/lib/pipeline";
import { createClientRedactionProvider } from "@/lib/provider/clientProvider";
import { getBackend, type NerBackendId, type NerLoadProgress } from "@/lib/ner";
import { attachRectsToEntities } from "@/lib/redact/mapEntitiesToRects";
import { buildRedactedDocument } from "@/lib/redact/textRedact";
import { buildRedactedPdf, type RedactedPdfResult } from "@/lib/redact/pdfVisual";
import type { Entity, PipelineProgress } from "@/lib/types";

type Stage = "setup" | "processing" | "review";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("setup");
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [modelProgress, setModelProgress] = useState<NerLoadProgress | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfExportStatus, setPdfExportStatus] = useState<Omit<RedactedPdfResult, "bytes"> | null>(null);

  async function handleStart(file: File, nerBackendId: NerBackendId | null) {
    setError(null);
    setStage("processing");
    setModelProgress(null);
    setProgress({ stage: "loading-pdf" });

    try {
      if (nerBackendId) {
        const backend = getBackend(nerBackendId);
        if (!backend.isLoaded()) {
          setProgress({ stage: "loading-model", detail: `Loading ${backend.label}` });
          await backend.load((info) => setModelProgress(info));
        }
      }

      const provider = createClientRedactionProvider(nerBackendId);
      const pipelineResult = await runPipeline(file, provider, setProgress);

      setResult(pipelineResult);
      setEntities(pipelineResult.entities);
      setStage("review");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong processing this PDF.");
      setStage("setup");
    }
  }

  function handleToggleEntity(id: string) {
    setEntities((prev) => prev.map((e) => (e.id === id ? { ...e, accepted: !e.accepted } : e)));
  }

  function handleAddManualEntity(page: number, start: number, end: number, text: string) {
    if (!result) return;
    const pageData = result.pages.find((p) => p.page === page);
    if (!pageData) return;

    const entity: Entity = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      start,
      end,
      text,
      label: "MANUAL_REDACTION",
      score: 1,
      source: "manual",
      page,
      accepted: true,
      rects: [],
    };
    attachRectsToEntities(pageData, [entity]);
    setEntities((prev) => [...prev, entity]);
  }

  function handleExportText() {
    if (!result) return;
    const pages = result.pages.map((p) => ({
      page: p.page,
      text: p.text,
      entities: entities.filter((e) => e.page === p.page),
    }));
    const redacted = buildRedactedDocument(pages);
    downloadBlob(
      new Blob([redacted.combinedText], { type: "text/plain" }),
      result.fileName.replace(/\.pdf$/i, "") + ".redacted.txt"
    );
  }

  async function handleExportPdf() {
    if (!result) return;
    setExportingPdf(true);
    setPdfExportStatus(null);
    try {
      const { bytes, verified, rasterizedPages } = await buildRedactedPdf(result.originalBytes, entities);
      setPdfExportStatus({ verified, rasterizedPages });
      downloadBlob(
        new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
        result.fileName.replace(/\.pdf$/i, "") + ".redacted.pdf"
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong building the redacted PDF.");
    } finally {
      setExportingPdf(false);
    }
  }

  function handleReset() {
    setStage("setup");
    setResult(null);
    setEntities([]);
    setProgress(null);
    setModelProgress(null);
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Client-side PII Redaction</h1>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {stage === "setup" && <UploadPanel onStart={handleStart} disabled={false} />}

      {stage === "processing" && <ProgressPanel progress={progress} modelProgress={modelProgress} />}

      {stage === "review" && result && (
        <div className="space-y-4">
          <button onClick={handleReset} className="text-sm text-gray-500 underline hover:text-gray-700 dark:hover:text-gray-300">
            ← Start over with another file
          </button>
          <ReviewScreen
            fileName={result.fileName}
            pages={result.pages}
            entities={entities}
            originalBytes={result.originalBytes}
            onToggleEntity={handleToggleEntity}
            onAddManualEntity={handleAddManualEntity}
            onExportText={handleExportText}
            onExportPdf={handleExportPdf}
            exportingPdf={exportingPdf}
            pdfExportStatus={pdfExportStatus}
          />
        </div>
      )}
    </div>
  );
}
