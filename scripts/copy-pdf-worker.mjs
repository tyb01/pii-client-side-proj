// pdf.js ships its worker as a standalone file that must be served
// statically (it can't be bundled by webpack). Next.js only serves files
// placed under /public, so we copy it there after every install.
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

mkdirSync(join(root, "public"), { recursive: true });
copyFileSync(
  join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  join(root, "public/pdf.worker.min.mjs")
);

console.log("Copied pdf.worker.min.mjs to public/");
