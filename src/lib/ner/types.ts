import type { EntityDraft } from "@/lib/regex/recognize";

export type NerBackendId = "openmed" | "distilbert";

export interface NerLoadProgress {
  /** 0-100, or undefined when the backend can't report granular progress. */
  progress?: number;
  detail?: string;
}

export interface NerBackend {
  id: NerBackendId;
  label: string;
  description: string;
  approxSizeMb: number;
  recommendedFor: "webgpu" | "wasm" | "any";
  isLoaded(): boolean;
  load(onProgress?: (info: NerLoadProgress) => void): Promise<void>;
  detect(text: string): Promise<EntityDraft[]>;
}
