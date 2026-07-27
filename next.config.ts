import type { NextConfig } from "next";

// This project runs on webpack, not Turbopack (see `--webpack` in the dev/
// build scripts). That was originally forced by GLiNER's bundled old
// @xenova/transformers (bare `import fs from 'fs'` that only webpack's
// `resolve.fallback` handled correctly), which is no longer a dependency
// (replaced by @huggingface/transformers directly for OpenMed/DistilBERT).
// Left on webpack rather than re-validating Turbopack now, since that's a
// separate, broader change than swapping the NER model.
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
    "@huggingface/transformers",
    "onnxruntime-web",
    "onnxruntime-common",
    "pdfjs-dist",
    "sharp",
  ],
  // Kept as a fallback for the case where someone runs plain `next dev`/
  // `next build` without `--webpack`; not currently re-validated against
  // Turbopack end-to-end (see note above).
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
