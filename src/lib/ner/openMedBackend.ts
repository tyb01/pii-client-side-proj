import type { NerBackend, NerLoadProgress } from "./types";
import type { EntityDraft } from "@/lib/regex/recognize";
import { chunkText } from "./chunkText";
import { postProcessChunkResults } from "./openMedPostProcess";
import type { InboundMessage, OutboundMessage, RawTokenClassificationResult } from "./openMedWorkerProtocol";

let worker: Worker | null = null;
let loaded = false;
let loadingPromise: Promise<void> | null = null;
let nextRequestId = 0;
const pendingDetects = new Map<
  number,
  { resolve: (results: RawTokenClassificationResult[]) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;

  // Inference runs off the main thread — the model is ~44M params but
  // still non-trivial per-chunk work, and this keeps the UI (including the
  // live PDF preview's rebuilds) responsive while it runs.
  worker = new Worker(new URL("./openmed.worker.ts", import.meta.url));
  worker.onmessage = (event: MessageEvent<OutboundMessage>) => {
    const msg = event.data;
    if (msg.type === "detect-result") {
      pendingDetects.get(msg.requestId)?.resolve(msg.results);
      pendingDetects.delete(msg.requestId);
    } else if (msg.type === "detect-error") {
      pendingDetects.get(msg.requestId)?.reject(new Error(msg.message));
      pendingDetects.delete(msg.requestId);
    }
    // "progress"/"loaded"/"load-error" are handled by one-off listeners
    // registered per-call in load(), not here.
  };
  return worker;
}

function detectOnWorker(text: string): Promise<RawTokenClassificationResult[]> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingDetects.set(requestId, { resolve, reject });
    const message: InboundMessage = { type: "detect", requestId, text };
    getWorker().postMessage(message);
  });
}

export const openMedBackend: NerBackend = {
  id: "openmed",
  label: "OpenMed Clinical PII",
  description:
    "Clinical PII model (56 entity types) fine-tuned specifically for PHI de-identification, not zero-shot — " +
    "covers names, IDs, contact info, and more out of the box.",
  approxSizeMb: 44,
  recommendedFor: "webgpu",

  isLoaded: () => loaded,

  async load(onProgress?: (info: NerLoadProgress) => void) {
    if (loaded) return;
    if (!loadingPromise) {
      loadingPromise = new Promise<void>((resolve, reject) => {
        const w = getWorker();
        const onMessage = (event: MessageEvent<OutboundMessage>) => {
          const msg = event.data;
          if (msg.type === "progress") {
            onProgress?.({ progress: msg.progress, detail: msg.detail });
          } else if (msg.type === "loaded") {
            w.removeEventListener("message", onMessage);
            loaded = true;
            resolve();
          } else if (msg.type === "load-error") {
            w.removeEventListener("message", onMessage);
            reject(new Error(msg.message));
          }
        };
        w.addEventListener("message", onMessage);
        const message: InboundMessage = { type: "load" };
        w.postMessage(message);
      });
    }
    try {
      await loadingPromise;
    } catch (err) {
      // Don't cache a rejected promise forever — a transient failure (e.g.
      // a network blip mid-download) should be retryable on the next click.
      loadingPromise = null;
      throw err;
    }
  },

  async detect(text: string): Promise<EntityDraft[]> {
    if (!loaded) throw new Error("OpenMed backend not loaded");
    if (!text.trim()) return [];

    const chunks = chunkText(text);
    const perChunk = await Promise.all(
      chunks.map(async (chunk) => ({
        results: await detectOnWorker(chunk.text),
        chunkText: chunk.text,
        chunkOffset: chunk.offset,
      }))
    );

    return postProcessChunkResults(perChunk, text);
  },
};
