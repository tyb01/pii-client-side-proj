/// <reference lib="webworker" />
// This file's global scope is a dedicated worker, not a DOM window — the
// rest of the project's tsconfig `lib` is ["dom", "dom.iterable", "esnext"]
// (needed everywhere else), so `self` is re-declared here rather than
// adding "webworker" project-wide, which would conflict with the DOM lib.
declare const self: DedicatedWorkerGlobalScope;

import type { InboundMessage, OutboundMessage } from "./openMedWorkerProtocol";

const MODEL_REPO = "OpenMed/OpenMed-PII-SuperClinical-Small-44M-v1-onnx-android";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null;

function post(message: OutboundMessage): void {
  self.postMessage(message);
}

/** Same real-adapter-request check as webgpu.ts, inlined: `navigator.gpu` is
 * exposed inside a dedicated worker too, but a worker can't import from a
 * module that also gets pulled into the main-thread bundle without webpack
 * duplicating the WebGPU check code either way, so this stays self-contained. */
async function canUseWebGPU(): Promise<boolean> {
  const nav = self.navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}

async function load(): Promise<void> {
  const { pipeline } = await import("@huggingface/transformers");

  const progress_callback = (info: { status: string; progress?: number }) => {
    if (info.status === "progress_total") {
      post({ progress: info.progress, detail: "Downloading OpenMed model…", type: "progress" });
    }
  };

  const webgpu = await canUseWebGPU();
  // This checkpoint's own model card is explicit that WebGPU pairs with the
  // fp16 graph and WASM pairs with int8 — not the same dtype for both, and
  // "q8" specifically maps to a "model_quantized.onnx" file this repo
  // doesn't ship (it ships model_int8.onnx / model_fp16.onnx / model.onnx).
  const device = webgpu ? "webgpu" : "wasm";
  const dtype = webgpu ? "fp16" : "int8";

  // This repo ships its ONNX files at the repo root (model_int8.onnx,
  // model_fp16.onnx, ...), not under the "onnx/" subfolder Transformers.js
  // assumes by default — without this override it 404s looking for
  // "onnx/model_int8.onnx", which doesn't exist here.
  pipe = await pipeline("token-classification", MODEL_REPO, { device, dtype, subfolder: "", progress_callback });
}

let loadingPromise: Promise<void> | null = null;

self.onmessage = async (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;

  if (msg.type === "load") {
    if (pipe) {
      post({ type: "loaded" });
      return;
    }
    if (!loadingPromise) {
      loadingPromise = load();
    }
    try {
      await loadingPromise;
      post({ type: "loaded" });
    } catch (err) {
      loadingPromise = null; // retryable on the next "load" message
      post({ type: "load-error", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === "detect") {
    if (!pipe) {
      post({ type: "detect-error", requestId: msg.requestId, message: "OpenMed model not loaded" });
      return;
    }
    try {
      const raw = await pipe(msg.text, { aggregation_strategy: "simple" });
      const results = Array.isArray(raw) ? raw : [raw];
      post({ type: "detect-result", requestId: msg.requestId, results });
    } catch (err) {
      post({
        type: "detect-error",
        requestId: msg.requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
