import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { ensurePdfWorkerConfigured, pdfjsLib } from "./src/lib/pdf/pdfjsSetup";
import { extractPageText } from "./src/lib/pdf/extract";

const require = createRequire(import.meta.url);

async function main() {
  ensurePdfWorkerConfigured();
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve("pdfjs-dist/build/pdf.worker.mjs")).href;

  const pdfPath =
    "C:/Users/hp/Downloads/OneDrive_1_23-07-2026/Case 4/Callahan_Medical_Records/07_Molecular_Pathology_NGS_Report.pdf";
  const data = new Uint8Array(readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const extracted = await extractPageText(pdf, pageNum);
    for (const label of ["Ordering Provider", "Reviewing Pathologist"]) {
      const idx = extracted.text.indexOf(label);
      if (idx === -1) continue;
      console.log(`\n=== page ${pageNum}: "${label}" at ${idx} ===`);
      console.log(JSON.stringify(extracted.text.slice(idx, idx + 150)));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
