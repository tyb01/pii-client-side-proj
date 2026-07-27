/** Message contract shared between openMedBackend.ts (main thread) and openmed.worker.ts. */

export interface RawTokenClassificationResult {
  entity_group: string;
  score: number;
  start?: number;
  end?: number;
  word: string;
}

export type InboundMessage =
  | { type: "load" }
  | { type: "detect"; requestId: number; text: string };

export type OutboundMessage =
  | { type: "progress"; progress?: number; detail?: string }
  | { type: "loaded" }
  | { type: "load-error"; message: string }
  | { type: "detect-result"; requestId: number; results: RawTokenClassificationResult[] }
  | { type: "detect-error"; requestId: number; message: string };
