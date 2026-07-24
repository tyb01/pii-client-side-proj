import { glinerBackend } from "./glinerBackend";
import { piiranhaBackend, distilbertBackend } from "./transformersBackend";
import { hasWebGPU } from "./webgpu";
import type { NerBackend, NerBackendId } from "./types";

export const NER_BACKENDS: Record<NerBackendId, NerBackend> = {
  gliner: glinerBackend,
  piiranha: piiranhaBackend,
  distilbert: distilbertBackend,
};

export const NER_BACKEND_LIST = Object.values(NER_BACKENDS);

/** WebGPU-capable devices default to the most accurate model; everything else gets the fast fallback. */
export function getRecommendedBackendId(): NerBackendId {
  return hasWebGPU() ? "gliner" : "distilbert";
}

export function getBackend(id: NerBackendId): NerBackend {
  return NER_BACKENDS[id];
}

export { hasWebGPU, canUseWebGPU } from "./webgpu";
export type { NerBackend, NerBackendId, NerLoadProgress } from "./types";
