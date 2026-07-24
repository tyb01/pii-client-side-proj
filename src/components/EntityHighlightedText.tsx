"use client";

import { useRef, useState } from "react";
import type { Entity } from "@/lib/types";
import { getTextOffsetWithinContainer } from "@/lib/textOffset";

const SOURCE_STYLES: Record<Entity["source"], string> = {
  regex: "bg-blue-200 dark:bg-blue-900/60",
  "ner-gliner": "bg-purple-200 dark:bg-purple-900/60",
  "ner-distilbert": "bg-green-200 dark:bg-green-900/60",
  manual: "bg-red-200 dark:bg-red-900/60",
};

interface Segment {
  type: "text" | "entity";
  value: string;
  entity?: Entity;
}

function buildSegments(text: string, entities: Entity[]): Segment[] {
  const sorted = [...entities].sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const entity of sorted) {
    if (entity.start < cursor) continue; // defensively skip overlaps
    if (entity.start > cursor) segments.push({ type: "text", value: text.slice(cursor, entity.start) });
    segments.push({ type: "entity", value: text.slice(entity.start, entity.end), entity });
    cursor = entity.end;
  }
  if (cursor < text.length) segments.push({ type: "text", value: text.slice(cursor) });

  return segments;
}

interface Props {
  text: string;
  entities: Entity[];
  onToggleEntity: (id: string) => void;
  onAddManualEntity: (start: number, end: number, text: string) => void;
}

export default function EntityHighlightedText({ text, entities, onToggleEntity, onAddManualEntity }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number; text: string } | null>(null);

  const segments = buildSegments(text, entities);

  function handleMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !containerRef.current) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) return;

    const start = getTextOffsetWithinContainer(containerRef.current, range.startContainer, range.startOffset);
    const end = getTextOffsetWithinContainer(containerRef.current, range.endContainer, range.endOffset);
    if (end <= start) return;

    // Refuse selections that overlap an existing entity — keeps segment rendering unambiguous.
    const overlaps = entities.some((e) => start < e.end && end > e.start);
    if (overlaps) return;

    setPendingSelection({ start, end, text: text.slice(start, end) });
  }

  function confirmManualRedaction() {
    if (!pendingSelection) return;
    onAddManualEntity(pendingSelection.start, pendingSelection.end, pendingSelection.text);
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div className="relative">
      {pendingSelection && (
        <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-800 dark:bg-red-950">
          <span className="truncate">
            Redact selection: <span className="font-mono">&quot;{pendingSelection.text}&quot;</span>
          </span>
          <button
            onClick={confirmManualRedaction}
            className="ml-auto shrink-0 rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700"
          >
            Redact
          </button>
          <button
            onClick={() => setPendingSelection(null)}
            className="shrink-0 rounded border px-2 py-1 hover:bg-red-100 dark:hover:bg-red-900"
          >
            Cancel
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-4 font-mono text-sm leading-relaxed text-gray-900 select-text dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      >
        {segments.map((seg, i) =>
          seg.type === "text" ? (
            <span key={i}>{seg.value}</span>
          ) : (
            <mark
              key={i}
              onClick={() => onToggleEntity(seg.entity!.id)}
              title={`${seg.entity!.label} · ${(seg.entity!.score * 100).toFixed(0)}% · ${seg.entity!.source}${
                seg.entity!.accepted ? "" : " (rejected - click to restore)"
              }`}
              className={`cursor-pointer rounded px-0.5 ${
                seg.entity!.accepted
                  ? SOURCE_STYLES[seg.entity!.source]
                  : "bg-transparent text-gray-400 line-through decoration-2 dark:text-gray-600"
              }`}
            >
              {seg.value}
            </mark>
          )
        )}
      </div>
    </div>
  );
}
