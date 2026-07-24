import { loadPdfDocument, extractPageText } from "@/lib/pdf/extract";

/**
 * Re-extracts text from the (already redacted) PDF bytes and checks whether
 * any target PII string is still recoverable, per page. This is the actual
 * proof that redaction worked — not an assumption. Any page that fails is
 * expected to be rasterized as a fallback by the caller.
 */
export async function findPagesWithResidualText(
  pdfBytes: Uint8Array,
  targetValuesByPage: Map<number, string[]>
): Promise<Set<number>> {
  const pdf = await loadPdfDocument(pdfBytes.slice());
  const residualPages = new Set<number>();

  for (const [pageNum, values] of targetValuesByPage) {
    if (pageNum < 1 || pageNum > pdf.numPages) continue;
    const uniqueValues = [...new Set(values.map((v) => v.trim()).filter((v) => v.length >= 2))];
    if (uniqueValues.length === 0) continue;

    const { text } = await extractPageText(pdf, pageNum);
    if (uniqueValues.some((value) => text.includes(value))) {
      residualPages.add(pageNum);
    }
  }

  return residualPages;
}
