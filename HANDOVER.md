# Handover: Client-Side PII/PHI Redaction Engine

Read this fully before touching anything. It tells you exactly what to copy, where it goes, and what you must NOT change.

## The one rule

**Copy the files listed below byte-for-byte. Do not rewrite, "clean up," simplify, or re-implement any of the logic inside `src/lib/`.**

Every file in `src/lib/` has been hardened against real bugs found by testing against dozens of real (synthetic but realistic) medical PDFs — regex boundary conditions, PDF content-stream encoding quirks, tokenizer edge cases, race conditions in worker messaging. None of this is visible from reading the code in isolation; it's only visible from the bug reports that produced each fix. A well-intentioned rewrite ("this regex looks overcomplicated, let me simplify it") will silently reintroduce a bug that took real diagnostic work to find. If something here looks wrong or unnecessary, assume it isn't and ask, rather than changing it.

The only things you should need to write yourself are: wiring (importing these modules into your existing pages/components) and your own review/redaction UI, if you don't want to reuse the provided one as-is.

---

## 1. What this is

A fully client-side (no server calls, nothing ever leaves the browser) pipeline that takes an uploaded PDF and produces a redacted version:

```
PDF upload
  → pdf.js text extraction (+ Tesseract.js OCR for scanned pages)
  → PII detection: regex recognizers + OpenMed NER model (in a Web Worker)
  → merge (regex wins over NER on overlap; manual edits win over both)
  → occurrence expansion (a name found once gets flagged everywhere else it appears)
  → review screen (accept/reject, manual redaction)
  → export: real PDF content-stream text removal (not just a black box) + verification + rasterization fallback
```

## 2. Files to copy — exact list

Copy these directories/files into the equivalent location in the target project's `src/`. Preserve the relative structure exactly — several files reference each other by relative path (especially the Web Worker, see §4).

### Core engine (framework-agnostic logic — copy verbatim)

```
src/lib/types.ts
src/lib/mergeEntities.ts
src/lib/pipeline.ts
src/lib/textOffset.ts

src/lib/regex/patterns.ts
src/lib/regex/recognize.ts
src/lib/regex/luhn.ts
src/lib/regex/ssnValidate.ts
src/lib/regex/accessionValidate.ts

src/lib/ner/types.ts
src/lib/ner/index.ts
src/lib/ner/webgpu.ts
src/lib/ner/transformersBackend.ts
src/lib/ner/openMedBackend.ts
src/lib/ner/openmed.worker.ts
src/lib/ner/openMedPostProcess.ts
src/lib/ner/openMedWorkerProtocol.ts
src/lib/ner/chunkText.ts

src/lib/pdf/extract.ts
src/lib/pdf/pdfjsSetup.ts

src/lib/ocr/runOcr.ts
src/lib/ocr/preprocess.ts

src/lib/redact/pdfVisual.ts
src/lib/redact/pdfTextSurgery.ts
src/lib/redact/pdfContentTokenizer.ts
src/lib/redact/pdfRasterize.ts
src/lib/redact/verifyRedaction.ts
src/lib/redact/textRedact.ts
src/lib/redact/mapEntitiesToRects.ts
src/lib/redact/expandOccurrences.ts

src/lib/provider/clientProvider.ts
src/lib/empty-module.ts
```

### Reference UI (optional — copy as a starting point, or build your own against the same props)

```
src/components/UploadPanel.tsx
src/components/ProgressPanel.tsx
src/components/ReviewScreen.tsx
src/components/EntityHighlightedText.tsx
src/components/PdfPreview.tsx
```

If the target app already has its own review/upload UI, you don't need these — just call `runPipeline()` / `createClientRedactionProvider()` / `buildRedactedPdf()` from your own components (see §5, "Integration surface"). But if you do adapt them, keep the *logic* inside each (state handling, the redaction/preview calls) intact and only restyle the JSX/markup.

### Assets and build config

```
scripts/copy-pdf-worker.mjs
```

---

## 3. Dependencies

Add these exact packages (versions this was built and tested against — newer patch versions are probably fine, don't jump major versions without re-testing):

```json
{
  "dependencies": {
    "@huggingface/transformers": "^4.2.0",
    "libphonenumber-js": "^1.13.9",
    "pdf-lib": "^1.17.1",
    "pdfjs-dist": "^4.10.38",
    "tesseract.js": "^5.1.1"
  }
}
```

`react`/`react-dom`/`next` are assumed already present in the target project.

---

## 4. Config changes required in the target project

These are the parts that DO need to be merged into the target's existing config, not copied wholesale (since the target already has its own `next.config.ts`/`package.json`/`tsconfig.json`).

### 4a. `package.json` — scripts

Add (or merge into existing scripts):

```json
{
  "scripts": {
    "dev": "next dev --webpack",
    "build": "next build --webpack",
    "postinstall": "node scripts/copy-pdf-worker.mjs"
  }
}
```

**The `--webpack` flag is not optional right now.** This project has never been run under Turbopack with the current dependency set — it was forced onto webpack originally because of a GLiNER dependency that's since been removed, so Turbopack *might* work now, but that has not been tested. Don't drop `--webpack` as part of this integration; treat re-validating Turbopack as a separate, later task if you want it.

If the target project has its own `postinstall` script already, chain both (`node scripts/copy-pdf-worker.mjs && <existing command>` or vice versa) rather than replacing it.

### 4b. `next.config.ts` — merge into the existing config function

The target's `next.config.ts` almost certainly has its own `webpack()` function and possibly its own `serverExternalPackages`. Merge (don't replace) these into whatever's already there:

```ts
serverExternalPackages: [
  // ...existing entries...
  "tesseract.js",
  "@huggingface/transformers",
  "onnxruntime-web",
  "onnxruntime-common",
  "pdfjs-dist",
  "sharp",
],
```

```ts
webpack: (config, { isServer }) => {
  // ...existing logic...
  config.resolve.alias = {
    ...config.resolve.alias,
    sharp$: false,
    "onnxruntime-node$": false,
    canvas: false,
    encoding: false,
  };
  if (!isServer) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
  }
  return config;
},
```

Why this exists: these ML/PDF/OCR libraries are browser-only, but Next.js still runs one server-side render pass over any `"use client"` page that imports them, so without this the build fails trying to bundle Node-only internals into the server compilation. See the comments in this project's own `next.config.ts` for the full reasoning — copy those comments over too so the next person doesn't delete this "unused-looking" config.

### 4c. `tsconfig.json` — path alias

All internal imports use `@/lib/...` / `@/components/...`. Either:
- adopt the same alias if the target doesn't already have a conflicting one:
  ```json
  "paths": { "@/*": ["./src/*"] }
  ```
- or, if the target has a different alias convention, that's the ONE exception where you're allowed to touch the copied files — but only to do a mechanical find/replace of the import specifier prefix, nothing else.

### 4d. Public asset

`scripts/copy-pdf-worker.mjs` copies `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` to `public/pdf.worker.min.mjs` on every `npm install`. Make sure this actually runs (via the `postinstall` hook above) — `pdfjsSetup.ts` points `GlobalWorkerOptions.workerSrc` at `"/pdf.worker.min.mjs"` and will fail to extract any PDF text if that file isn't present under the target's `public/`.

---

## 5. Integration surface — what to actually call from your code

You don't need to understand the internals to wire this up. Three entry points:

```ts
import { runPipeline } from "@/lib/pipeline";
import { createClientRedactionProvider } from "@/lib/provider/clientProvider";
import { getBackend, type NerBackendId } from "@/lib/ner";
import { buildRedactedPdf } from "@/lib/redact/pdfVisual";
import { buildRedactedDocument } from "@/lib/redact/textRedact";
```

1. **Run detection** on an uploaded `File`:
   ```ts
   const backendId: NerBackendId | null = "openmed"; // or "distilbert", or null for regex-only
   if (backendId) {
     const backend = getBackend(backendId);
     await backend.load((progress) => { /* update your own loading UI */ });
   }
   const provider = createClientRedactionProvider(backendId);
   const result = await runPipeline(file, provider, (progress) => { /* update your own progress UI */ });
   // result.pages, result.entities, result.originalBytes, result.fileName
   ```
2. **Let the user review/toggle entities** — `result.entities` is an `Entity[]` (see `src/lib/types.ts`); each has `accepted: boolean` you can flip in your own UI.
3. **Export**:
   - Redacted PDF: `const { bytes, verified, rasterizedPages } = await buildRedactedPdf(result.originalBytes, entities);`
   - Redacted plain text: `const { combinedText } = buildRedactedDocument(pages);`

If you copied the reference UI (§2), `src/app/page.tsx` (not in the copy list — that one *is* yours to rewrite, it's just the demo shell) shows the full wiring of all three steps together; use it as the reference for exactly this, then delete/replace it with your own page.

---

## 6. Things NOT to "fix" — known, deliberate design choices

If you or a future dev look at these and think they're bugs, they aren't:

- **`GENDER`, `AGE`, `DATE`, `TIME_OF_DAY`, `COLLECTION_DATE` are filtered out entirely** in `clientProvider.ts` (never become entities at all) — this is an intentional policy decision (these aren't identifying on their own and are clinically necessary), not a detection gap. Only `DATE_OF_BIRTH` is redacted.
- **`occupation` is filtered out** in `openMedPostProcess.ts` for the same reason.
- **No `Piiranha` NER backend** — it was tried and abandoned; its ONNX export produced degenerate all-"O" predictions at the default quantization and was never made to work reliably. Don't re-add it without investigating that from scratch.
- **GLiNER was replaced with OpenMed** (`OpenMed/OpenMed-PII-SuperClinical-Small-44M-v1-onnx-android`) — GLiNER is zero-shot and more flexible in theory, but OpenMed is purpose-trained for PII/PHI and performed better in testing. If you're tempted to add zero-shot label flexibility back, that's a real tradeoff to discuss, not a bug to fix.
- **`redactPageTextInPlace` in `pdfTextSurgery.ts` blanks bytes in place rather than rebuilding the content stream** — this is deliberate (avoids "reformatted something subtly wrong" bugs). The `charRawRanges` mapping in `pdfContentTokenizer.ts` exists specifically to handle PDF string-escape sequences (`\(`, `\)`, octal escapes) correctly when computing exact byte offsets — don't simplify this back to a naive string search.
- **The `IDENTIFIER` regex recognizer in `patterns.ts` has unusual-looking lookaheads** (excluding parentheses from "label tokens," treating `/` as a joiner not a token, requiring `Reference`/`Ref` to have a `Number`/`No` qualifier) — each of these exists to fix one specific real false-positive or false-negative found via testing against real PDFs. The comments directly above each one explain which.
- **`mergeEntityDrafts` prefers the wider span on same-priority ties, not just "whichever was found first"** — this is what stops a value from being only partially redacted when two recognizers disagree on where it ends.

---

## 7. Testing after integration

1. `npm install`, confirm `public/pdf.worker.min.mjs` exists.
2. `npm run dev` (must include `--webpack`).
3. Upload a real (or synthetic) medical-report-style PDF, select the OpenMed backend, run detection.
4. Open the browser console — a `console.table` of every detected entity (text/label/source/confidence) prints automatically at the end of `runPipeline` (in `pipeline.ts`), useful for verifying detection didn't regress.
5. Export both the redacted PDF and redacted `.txt`, and confirm no original PII text is recoverable (the exported PDF's own verification banner reports this; for `.txt` just visually check).
