import type { Gliner } from "gliner";
import type { NerBackend, NerLoadProgress } from "./types";
import type { EntityDraft } from "@/lib/regex/recognize";
import { canUseWebGPU } from "./webgpu";

// NOTE: onnx-community/gliner_multi_pii-v1 (the PII-fine-tuned checkpoint)
// was tried first but performs badly on our custom medical-role labels
// ("patient name", "referring physician", etc.) — its fine-tuning narrowed
// it to its OWN fixed PII vocabulary (person, ssn, email, iban, ...), and
// scores for anything outside that list came back uniformly under ~20%
// confidence, well below any usable threshold. gliner_small-v2.1 is the
// general-purpose zero-shot checkpoint (not narrowed to a fixed label set),
// which is what actually generalizes to novel labels the way GLiNER is
// supposed to.
const MODEL_REPO = "onnx-community/gliner_small-v2.1";
const hfFile = (file: string) =>
  `https://huggingface.co/${MODEL_REPO}/resolve/main/${file}`;

// Zero-shot labels passed to GLiNER at inference time — this is the whole
// point of GLiNER: no retraining needed to recognize domain-specific labels
// like "referring physician" that generic NER models don't distinguish.
//
// Split into small focused GROUPS rather than one big list: testing showed
// that handing GLiNER all ~23 labels in a single call measurably HURT
// recall (it caught only patient names and lost physician names/address it
// found fine with a smaller list) — more candidate types gives the model
// more ways to second-guess itself. Running one inference pass per group
// keeps each pass's confidence quality close to what a short, focused list
// gets, at the cost of ~1 extra pass per group. Each group stays well
// under gliner_config.json's `max_types: 25` ceiling on its own.
const GLINER_LABEL_GROUPS: string[][] = [
  // People
  [
    "patient name",
    "doctor name",
    "referring physician",
    "radiologist name",
    "nurse name",
    "emergency contact name",
    "person name",
  ],
  // Identifiers / codes
  [
    "medical record number",
    "accession number",
    "lab code",
    "security code",
    "national id number",
    "social security number",
    "insurance policy number",
  ],
  // Contact / location / dates / organizations
  [
    "phone number",
    "email address",
    "address",
    "clinic name",
    "hospital name",
    "insurance company",
    "date of birth",
    "gender",
    "collection date",
  ],
];

function toEntityLabel(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const MODEL_CACHE_NAME = "gliner-model-cache-v1";

/**
 * Fetches the (large, ~350MB) model ourselves instead of handing
 * onnxruntime-web a bare URL: this gives real download-progress reporting
 * and caches the raw bytes via the Cache API so later loads are instant,
 * without depending on whatever internal fetch strategy onnxruntime-web's
 * URL-based `InferenceSession.create` uses for very large remote files.
 */
async function fetchModelBytes(
  url: string,
  onProgress?: (fraction: number) => void
): Promise<Uint8Array> {
  const cache = await caches.open(MODEL_CACHE_NAME).catch(() => null);
  const cached = await cache?.match(url);
  if (cached) {
    onProgress?.(1);
    return new Uint8Array(await cached.arrayBuffer());
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download GLiNER model: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress?.(received / total);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    await cache?.put(url, new Response(bytes));
  } catch {
    // Cache API has storage quotas; a failed cache write just means next
    // time downloads again — the model still works fine this session.
  }

  return bytes;
}

let instance: Gliner | null = null;
let loadingPromise: Promise<void> | null = null;

export const glinerBackend: NerBackend = {
  id: "gliner",
  label: "GLiNER (zero-shot PII)",
  description:
    "Understands custom labels like 'referring physician' without retraining. Large one-time download " +
    "(~183MB on WASM, ~306MB fp16 on WebGPU).",
  // Fixed (not hasWebGPU()-branched): this is rendered directly into SSR'd
  // JSX, and `navigator.gpu` doesn't exist on the server — branching here
  // would make the server and client render different text and trigger a
  // hydration mismatch.
  approxSizeMb: 183,
  recommendedFor: "webgpu",

  isLoaded: () => instance !== null,

  async load(onProgress?: (info: NerLoadProgress) => void) {
    if (instance) return;
    if (!loadingPromise) {
      loadingPromise = (async () => {
        // Loaded dynamically so this heavy client-only dependency chain
        // (gliner -> @xenova/transformers -> optional sharp/onnxruntime-node)
        // is never evaluated during server-side rendering of this "use
        // client" tree — only when a browser click actually calls load().
        const { Gliner } = await import("gliner");

        const modelBytes = await fetchModelBytes(hfFile("onnx/model_quantized.onnx"), (fraction) => {
          onProgress?.({
            progress: Math.round(fraction * 100),
            detail: `Downloading GLiNER model… ${Math.round(fraction * 100)}%`,
          });
        });

        const makeGliner = (executionProvider: "webgpu" | "wasm") =>
          new Gliner({
            tokenizerPath: MODEL_REPO,
            onnxSettings: {
              // Pre-fetched bytes (not a URL): onnxruntime-web's own
              // URL-based fetch for a ~350MB remote file was unreliable in
              // testing ("Failed to fetch"); handing it the raw bytes we
              // already downloaded above sidesteps that entirely. Always
              // the quantized (int8) weights: fp16 tensor ops aren't
              // supported on every WebGPU implementation, so a fp16-only
              // model would crash on those devices.
              modelPath: modelBytes,
              executionProvider,
              multiThread: true,
            },
            transformersSettings: {
              allowLocalModels: false,
              useBrowserCache: true,
            },
            maxWidth: 12,
          });

        // `navigator.gpu` existing doesn't guarantee a real adapter is
        // obtainable (blocklisted GPU, outdated driver, headless browsers
        // without GPU flags all report the API but fail on first use) —
        // actually request one before committing to the webgpu provider.
        const webgpu = await canUseWebGPU();
        const g = makeGliner(webgpu ? "webgpu" : "wasm");
        await g.initialize();

        onProgress?.({ progress: 100, detail: "GLiNER ready" });
        instance = g;
      })();
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
    if (!instance) throw new Error("GLiNER backend not loaded");
    if (!text.trim()) return [];

    // `inference()` runs the whole text as one batch with no length
    // handling — GLiNER's backbone was trained on sequences up to ~384
    // tokens (see gliner_config.json's `max_len`), and once a group's
    // entity-label prompts are added on top, anything beyond a short page
    // silently produces zero (or badly degraded) spans instead of an
    // error. `inference_with_chunking` splits the page into ~512-word
    // sub-batches and runs each separately, which is the library's
    // documented way to handle real (multi-paragraph) documents.
    //
    // Threshold calibrated empirically against a real multi-section report:
    // this zero-shot model's own confidence on genuinely-correct name spans
    // ran 18-49% (never near the naive "0.5 = confident" assumption), while
    // clearly-wrong spans (drug/antibody clone codes, lab values) mostly
    // stayed under 10%. 0.15 catches the real names without drowning in
    // noise; the review screen is the backstop for whatever slips through
    // either direction.
    const byStartEnd = new Map<string, EntityDraft>();

    for (const labelGroup of GLINER_LABEL_GROUPS) {
      const [results] = await instance.inference_with_chunking({
        texts: [text],
        entities: labelGroup,
        threshold: 0.15,
        flatNer: true,
      });

      for (const r of results) {
        const key = `${r.start}:${r.end}`;
        const existing = byStartEnd.get(key);
        if (existing && existing.score >= r.score) continue; // same span from an earlier group already won
        byStartEnd.set(key, {
          start: r.start,
          end: r.end,
          text: r.spanText,
          label: toEntityLabel(r.label),
          score: r.score,
          source: "ner-gliner" as const,
        });
      }
    }

    return [...byStartEnd.values()];
  },
};
