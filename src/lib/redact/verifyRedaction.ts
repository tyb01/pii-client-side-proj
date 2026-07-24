import { loadPdfDocument, extractPageText } from "@/lib/pdf/extract";

/**
 * Re-extracts text from the (already redacted) PDF bytes and checks, per
 * page, exactly which target values are still recoverable — not just
 * whether the page has ANY residual text. This is what lets the caller box
 * only the specific entities that byte-level surgery actually failed to
 * remove, rather than treating every entity on a page as failed just
 * because one of them was (surgery can succeed for most values on a page
 * and fail for a few, e.g. one field using a font the surgery pass can't
 * safely decode).
 */
export async function findResidualValuesByPage(
  pdfBytes: Uint8Array,
  targetValuesByPage: Map<number, string[]>
): Promise<Map<number, Set<string>>> {
  const pdf = await loadPdfDocument(pdfBytes.slice());
  const residualByPage = new Map<number, Set<string>>();

  for (const [pageNum, values] of targetValuesByPage) {
    if (pageNum < 1 || pageNum > pdf.numPages) continue;
    const uniqueValues = [...new Set(values.map((v) => v.trim()).filter((v) => v.length >= 2))];
    if (uniqueValues.length === 0) continue;

    const { text } = await extractPageText(pdf, pageNum);
    const found = new Set(uniqueValues.filter((value) => text.includes(value)));
    if (found.size > 0) residualByPage.set(pageNum, found);
  }

  return residualByPage;
}
