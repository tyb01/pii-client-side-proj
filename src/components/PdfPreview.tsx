"use client";

import { useEffect, useRef, useState } from "react";
import type { Entity } from "@/lib/types";
import { buildRedactedPdf } from "@/lib/redact/pdfVisual";

interface Props {
  originalBytes: ArrayBuffer;
  entities: Entity[];
}

export default function PdfPreview({ originalBytes, entities }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(true);
  const urlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;

    // Debounced (not literally per-click): a rebuild re-runs the full
    // pdf-lib surgery + pdf.js re-verification pass, occasionally
    // rasterization, so firing it on every single toggle during rapid
    // review would pile up. 300ms keeps it feeling instant once the user
    // pauses, without doing that work on every click. `setRegenerating`
    // is set from inside this callback (not synchronously in the effect
    // body) so React doesn't treat it as a render-triggered cascade.
    const timer = setTimeout(async () => {
      setRegenerating(true);
      try {
        const { bytes } = await buildRedactedPdf(originalBytes, entities);
        if (generation !== generationRef.current) return; // a newer edit already superseded this run
        const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
        const nextUrl = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = nextUrl;
        setUrl(nextUrl);
      } catch (err) {
        console.error("PDF preview generation failed:", err);
      } finally {
        if (generation === generationRef.current) setRegenerating(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [originalBytes, entities]);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
      {regenerating && (
        <div className="absolute right-2 top-2 z-10 rounded bg-gray-900/80 px-2 py-1 text-xs text-white">
          Updating preview…
        </div>
      )}
      {url ? (
        <iframe title="Redacted PDF preview" src={url} className="h-[80vh] w-full" />
      ) : (
        <div className="flex h-[80vh] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
          Generating preview…
        </div>
      )}
    </div>
  );
}
