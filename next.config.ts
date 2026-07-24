import type { NextConfig } from "next";

// This project runs on webpack, not Turbopack (see `--webpack` in the dev/
// build scripts), specifically because of GLiNER: `gliner` bundles an old
// @xenova/transformers whose env.js does `import fs from 'fs'` (bare
// specifier) and crashes with "Cannot convert undefined or null to object"
// unless something provides a non-nullish `fs`. webpack's `resolve.fallback`
// handles that correctly (see below); Turbopack's `resolveAlias` — including
// the documented `{ browser: ... }` conditional form — does not seem to
// intercept this specific bare Node-builtin import in dynamically imported
// chunks, at least as of Next.js 16.2 / gliner 0.0.19. If a future version
// fixes this, `--webpack` can be dropped from the scripts.
const nextConfig: NextConfig = {
  // These heavy ML/PDF/OCR libraries are only ever meant to run in the
  // browser, but this "use client" page still gets server-rendered once on
  // first load, so Next tries to bundle them into the server compilation
  // too. Excluding them from server bundling means Node's normal `require`
  // resolves their internals directly (real `fs`, real `path`, etc.) instead
  // of running through webpack resolution — since none of this code
  // actually executes during SSR (everything heavy is behind dynamic
  // imports triggered by a browser click), that's enough to make server
  // rendering succeed without needing them to actually work in Node.
  serverExternalPackages: [
    "tesseract.js",
    "gliner",
    "@xenova/transformers",
    "@huggingface/transformers",
    "onnxruntime-web",
    "onnxruntime-common",
    "pdfjs-dist",
    "sharp",
  ],
  // Kept for the (currently non-functional-for-GLiNER, see note above) case
  // where someone runs plain `next dev`/`next build` without `--webpack`.
  turbopack: {
    resolveAlias: {
      sharp: "./src/lib/empty-module.ts",
      "onnxruntime-node": "./src/lib/empty-module.ts",
      canvas: "./src/lib/empty-module.ts",
      encoding: "./src/lib/empty-module.ts",
      fs: "./src/lib/empty-module.ts",
    },
  },
  webpack: (config, { isServer }) => {
    // sharp/onnxruntime-node/canvas/encoding are optional native/node-only
    // deps that don't ship browser builds and must not enter the client bundle.
    config.resolve.alias = {
      ...config.resolve.alias,
      sharp$: false,
      "onnxruntime-node$": false,
      canvas: false,
      encoding: false,
    };
    if (!isServer) {
      // `false` here (webpack's documented "Node core module" fallback,
      // distinct from `resolve.alias`) makes `import fs from 'fs'` resolve
      // to an empty module in the browser bundle instead of throwing
      // "Module not found: Can't resolve 'fs'". An empty object is enough
      // for @xenova/transformers' `Object.keys(fs)`-based feature detection
      // to correctly conclude "no real filesystem here" without crashing.
      // Don't do the same for `path` — tesseract.js calls real
      // `path.join`/`path.parse` at runtime, and webpack's default browser
      // polyfill for `path` already provides that.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    return config;
  },
};

export default nextConfig;
