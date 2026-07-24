import type { TokenClassificationPipeline } from "@huggingface/transformers";
import type { NerBackend, NerBackendId, NerLoadProgress } from "./types";
import type { EntityDraft } from "@/lib/regex/recognize";
import { canUseWebGPU } from "./webgpu";

interface TransformersBackendConfig {
  id: NerBackendId;
  label: string;
  description: string;
  modelRepo: string;
  approxSizeMb: number;
  recommendedFor: "webgpu" | "wasm" | "any";
  /** Maps the model's raw entity_group (e.g. "TELEPHONENUM", "PER") to our normalized label set. */
  labelMap: Record<string, string>;
  /** Minimum score to keep a grouped entity. */
  threshold?: number;
  /** ONNX weight precision to request. Defaults to "q8" if omitted. */
  dtype?: "q8" | "fp32" | "fp16" | "q4";
}

function normalizeLabel(map: Record<string, string>, raw: string): string {
  return map[raw] ?? raw.toUpperCase();
}

/** Best-effort recovery of char offsets when the tokenizer didn't attach them. */
function locateWord(text: string, word: string, searchFrom: number): { start: number; end: number } | null {
  const cleaned = word.replace(/^##/, "");
  const idx = text.indexOf(cleaned, searchFrom);
  if (idx === -1) return null;
  return { start: idx, end: idx + cleaned.length };
}

/**
 * WordPiece aggregation occasionally clips the last character or two off a
 * name (e.g. "Nandakumar" -> "Nandakuma") when a trailing subword's own
 * offset is off by one — which then breaks placeholder consistency, since
 * the clipped and unclipped mentions of the same name no longer match as
 * the same string. Extending to the nearest letter-run boundary on both
 * sides fixes this without needing to touch the model itself.
 */
function snapToWordBoundary(text: string, start: number, end: number): { start: number; end: number } {
  const isWordChar = (ch: string | undefined) => !!ch && /[A-Za-z]/.test(ch);
  while (start > 0 && isWordChar(text[start - 1]) && isWordChar(text[start])) start -= 1;
  while (end < text.length && isWordChar(text[end - 1]) && isWordChar(text[end])) end += 1;
  return { start, end };
}

export function createTransformersBackend(config: TransformersBackendConfig): NerBackend {
  let pipe: TokenClassificationPipeline | null = null;
  let loadingPromise: Promise<void> | null = null;

  return {
    id: config.id,
    label: config.label,
    description: config.description,
    approxSizeMb: config.approxSizeMb,
    recommendedFor: config.recommendedFor,

    isLoaded: () => pipe !== null,

    async load(onProgress?: (info: NerLoadProgress) => void) {
      if (pipe) return;
      if (!loadingPromise) {
        loadingPromise = (async () => {
          // Dynamically imported so it's never evaluated during SSR of this
          // "use client" tree — only when a browser click calls load().
          const { pipeline } = await import("@huggingface/transformers");
          const progress_callback = (info: { status: string; progress?: number }) => {
            if (info.status === "progress_total") {
              onProgress?.({ progress: info.progress, detail: `Downloading ${config.label}…` });
            }
          };

          // `navigator.gpu` existing doesn't guarantee a real adapter is
          // obtainable (blocklisted GPU, outdated driver, headless browser
          // without GPU flags all report the API but fail on first use) —
          // actually request one before committing to the webgpu device.
          const device = (await canUseWebGPU()) ? "webgpu" : "wasm";
          pipe = await pipeline("token-classification", config.modelRepo, {
            device,
            dtype: config.dtype ?? "q8",
            progress_callback,
          });
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
      if (!pipe) throw new Error(`${config.label} backend not loaded`);
      if (!text.trim()) return [];

      const results = await pipe(text, { aggregation_strategy: "simple" });
      const grouped = Array.isArray(results) ? results : [results];

      const out: EntityDraft[] = [];
      let cursor = 0;
      for (const r of grouped) {
        if (config.threshold && r.score < config.threshold) continue;
        let span = r.start !== undefined && r.end !== undefined ? { start: r.start, end: r.end } : null;
        if (!span) span = locateWord(text, r.word, cursor);
        if (!span) continue;
        span = snapToWordBoundary(text, span.start, span.end);
        cursor = span.end;

        out.push({
          start: span.start,
          end: span.end,
          text: text.slice(span.start, span.end),
          label: normalizeLabel(config.labelMap, r.entity_group),
          score: r.score,
          source: config.id === "piiranha" ? "ner-piiranha" : "ner-distilbert",
        });
      }
      return out;
    },
  };
}

export const piiranhaBackend = createTransformersBackend({
  id: "piiranha",
  label: "Piiranha (PII-specific)",
  description: "DeBERTa-based, trained specifically on PII across 17 entity types. Good balance of size/recall.",
  modelRepo: "onnx-community/piiranha-v1-detect-personal-information-ONNX",
  // Fixed, not hasWebGPU()-branched — see comment on glinerBackend's approxSizeMb.
  approxSizeMb: 317,
  recommendedFor: "any",
  threshold: 0.5,
  // KNOWN ISSUE (unresolved, investigation paused): at the default q8
  // dtype, this model's raw per-token predictions come back "O" (not-PII)
  // for every single token — even on its own HF model-card demo sentence
  // ("My name is Sarah and I live in London.") — so almost nothing gets
  // detected regardless of threshold. Not yet confirmed whether a
  // different dtype (fp32 is ~1.15GB, untested) fixes it or whether the
  // issue is elsewhere in this ONNX export. Treat this backend's results
  // as unreliable until that's resolved.
  labelMap: {
    ACCOUNTNUM: "ACCOUNT_NUMBER",
    BUILDINGNUM: "BUILDING_NUMBER",
    CITY: "CITY",
    CREDITCARDNUMBER: "CREDIT_CARD",
    DATEOFBIRTH: "DATE_OF_BIRTH",
    DRIVERLICENSENUM: "LICENSE_NUMBER",
    EMAIL: "EMAIL_ADDRESS",
    GIVENNAME: "PERSON_GIVEN_NAME",
    IDCARDNUM: "ID_CARD_NUMBER",
    PASSWORD: "PASSWORD",
    SOCIALNUM: "SSN",
    STREET: "STREET_ADDRESS",
    SURNAME: "PERSON_SURNAME",
    TAXNUM: "TAX_ID",
    TELEPHONENUM: "PHONE_NUMBER",
    USERNAME: "USERNAME",
    ZIPCODE: "ZIP_CODE",
  },
});

export const distilbertBackend = createTransformersBackend({
  id: "distilbert",
  label: "DistilBERT NER (fast fallback)",
  description: "Small, fast, runs everywhere. Only detects person/org/location/date — lean on regex + review for the rest.",
  modelRepo: "Xenova/distilbert-base-multilingual-cased-ner-hrl",
  approxSizeMb: 135,
  recommendedFor: "wasm",
  threshold: 0.6,
  labelMap: {
    PER: "PERSON",
    ORG: "ORGANIZATION",
    LOC: "LOCATION",
    DATE: "DATE",
  },
});
