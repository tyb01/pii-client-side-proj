import { openMedBackend } from "./openMedBackend";
import { distilbertBackend } from "./transformersBackend";
import { hasWebGPU } from "./webgpu";
import type { NerBackend, NerBackendId } from "./types";

export const NER_BACKENDS: Record<NerBackendId, NerBackend> = {
  openmed: openMedBackend,
  distilbert: distilbertBackend,
};

export const NER_BACKEND_LIST = Object.values(NER_BACKENDS);

/** WebGPU-capable devices default to the most accurate model; everything else gets the fast fallback. */
export function getRecommendedBackendId(): NerBackendId {
  return hasWebGPU() ? "openmed" : "distilbert";
}

export function getBackend(id: NerBackendId): NerBackend {
  return NER_BACKENDS[id];
}

export { hasWebGPU, canUseWebGPU } from "./webgpu";
export type { NerBackend, NerBackendId, NerLoadProgress } from "./types";
