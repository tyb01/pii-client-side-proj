import {
  PDFDocument,
  PDFPage,
  PDFName,
  PDFDict,
  PDFArray,
  PDFStream,
  PDFRawStream,
  PDFContentStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";
import { scanTextShowOperators, type StringOperand } from "./pdfContentTokenizer";

/**
 * Attempts to permanently remove PII text from a page's content stream by
 * overwriting the exact bytes of matched string operands with spaces — NOT
 * by drawing a box on top. Byte ranges are patched in place (same length),
 * so nothing else in the stream needs to shift or be re-serialized.
 *
 * Scope/safety: only simple (non-Type0), non-Differences-encoded fonts are
 * treated as safely decodable (as Latin-1/ASCII, which is correct for the
 * overwhelming majority of plain English text PDFs, including WinAnsi —
 * the default for embedded standard fonts). Anything we can't confidently
 * decode is left untouched here; the caller is expected to re-verify via
 * text extraction afterward and fall back to rasterizing any page where a
 * target string is still found, so an imperfect match here never means an
 * unredacted page ships — it just means this fast path didn't cover it.
 *
 * Returns whether every target string was found and blanked via this
 * method, so the caller knows whether verification is just a safety check
 * or something it should expect to actually catch.
 */
export function redactPageTextInPlace(
  pdfDoc: PDFDocument,
  page: PDFPage,
  targetValues: string[]
): { modified: boolean; allTargetsMatched: boolean } {
  const uniqueTargets = [...new Set(targetValues.map((v) => v.trim()).filter((v) => v.length >= 2))];
  if (uniqueTargets.length === 0) return { modified: false, allTargetsMatched: true };

  const contentBytes = getPageContentBytes(pdfDoc, page);
  if (contentBytes.length === 0) return { modified: false, allTargetsMatched: false };

  const unsafeFontNames = getUnsafeFontNames(pdfDoc, page);
  const events = scanTextShowOperators(contentBytes);

  // Build the reconstructed "safe" text for this page (unsafe-font operands
  // contribute nothing, so they can never accidentally bridge or match).
  //
  // A single separator character is inserted BETWEEN events (not between
  // operands within the same event): a `TJ` array's multiple string
  // operands are typically kerning-split pieces of one word/line (no gap
  // wanted there), while separate events (separate Tj/TJ/'/") more often
  // correspond to a new line — e.g. a wrapped multi-line field like
  // "Hannah Whitmore, MD, FRCSC" / "(Gynecologic Oncology)", which pdf.js's
  // OWN text extraction (the source of `entity.text`) already joins with a
  // space or newline. Without this, an entity spanning such a wrap could
  // never be found here at all (its target string has a whitespace
  // character with nothing corresponding to it in the raw concatenation),
  // permanently forcing it into the box+rasterize fallback.
  const operands: StringOperand[] = [];
  const operandTextStart: number[] = [];
  let reconstructed = "";

  for (const event of events) {
    if (reconstructed.length > 0) reconstructed += " ";
    for (const operand of event.strings) {
      const isSafe = !(operand.fontName && unsafeFontNames.has(operand.fontName));
      const text = isSafe ? latin1Decode(operand.bytes) : "";
      operandTextStart.push(reconstructed.length);
      operands.push(operand);
      reconstructed += text;
    }
  }

  // Whitespace-flexible search: pdf.js may have joined the same two runs
  // with a plain space OR a newline (its choice, based on `hasEOL`), and our
  // own event-boundary separator above is always a plain space — rather
  // than guess which exact character to match, collapse any whitespace run
  // in the target to "one or more whitespace" when searching.
  const matchedRanges: { start: number; end: number }[] = [];
  const targetsFound = new Set<string>();
  for (const target of uniqueTargets) {
    const re = buildFlexibleTargetRegex(target);
    let m: RegExpExecArray | null;
    while ((m = re.exec(reconstructed)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      matchedRanges.push({ start: m.index, end: m.index + m[0].length });
      targetsFound.add(target);
    }
  }

  if (matchedRanges.length === 0) {
    return { modified: false, allTargetsMatched: false };
  }

  const patched = new Uint8Array(contentBytes); // copy — never mutate the shared original
  let anyBlanked = false;

  operands.forEach((operand, idx) => {
    const opStart = operandTextStart[idx];
    const opEnd = opStart + operand.bytes.length;
    if (opEnd === opStart) return; // unsafe-font or empty operand, nothing to check

    const overlapping = matchedRanges.filter((r) => opStart < r.end && opEnd > r.start);
    if (overlapping.length === 0) return;

    // Blank only the matched substring(s) within this operand, not the
    // whole thing — a content stream commonly draws an entire justified
    // line as ONE string operand, so a single matched value inside a long
    // line must not take the rest of the line down with it. Escape
    // sequences (`\(`, `\n`, ...) don't force a whole-operand fallback:
    // `charRawRanges` maps each decoded character to its own exact raw
    // byte span, escaped or not.
    for (const r of overlapping) {
      const subStart = Math.max(r.start, opStart) - opStart;
      const subEnd = Math.min(r.end, opEnd) - opStart;
      if (subEnd <= subStart) continue;
      const rawStart = operand.charRawRanges[subStart].start;
      const rawEnd = operand.charRawRanges[subEnd - 1].end;
      blankRange(patched, rawStart, rawEnd, operand.range.kind);
    }
    anyBlanked = true;
  });

  if (!anyBlanked) return { modified: false, allTargetsMatched: false };

  setPageContentBytes(pdfDoc, page, patched);
  return { modified: true, allTargetsMatched: targetsFound.size === uniqueTargets.length };
}

/** Escapes regex metacharacters, then relaxes any whitespace run to match one-or-more whitespace of any kind. */
function buildFlexibleTargetRegex(target: string): RegExp {
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flexible = escaped.replace(/\s+/g, "\\s+");
  return new RegExp(flexible, "g");
}

function latin1Decode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** Overwrites content bytes in [start, end) with spaces — for hex strings, with '2','0' pairs so it still decodes as valid hex. */
function blankRange(bytes: Uint8Array, start: number, end: number, kind: "literal" | "hex"): void {
  if (kind === "hex") {
    for (let i = start; i < end; i++) {
      bytes[i] = (i - start) % 2 === 0 ? 0x32 /* '2' */ : 0x30 /* '0' */;
    }
  } else {
    for (let i = start; i < end; i++) bytes[i] = 0x20; // space
  }
}

/**
 * `getContents()` does NOT reliably return readable operator bytes:
 *  - `PDFRawStream` (content streams loaded from an existing file) returns
 *    the bytes exactly as stored — still FlateDecode-compressed if the
 *    stream has a /Filter. Needs `decodePDFRawStream(...).decode()`.
 *  - `PDFContentStream` (freshly created in this session, e.g. by our own
 *    `page.drawRectangle()`/`drawText()` calls) is a `PDFFlateStream` whose
 *    `getContents()` COMPRESSES its operators on demand and returns THAT —
 *    also not readable. Needs `getUnencodedContents()` instead.
 * Skipping the right one of these means scanning compressed binary noise
 * and silently finding zero text operators.
 */
function getDecodedStreamBytes(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFContentStream) {
    return stream.getUnencodedContents();
  }
  if (stream instanceof PDFRawStream) {
    return decodePDFRawStream(stream).decode();
  }
  return stream.getContents();
}

function getPageContentBytes(pdfDoc: PDFDocument, page: PDFPage): Uint8Array {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array(0);

  if (contents instanceof PDFArray) {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < contents.size(); i++) {
      try {
        const ref = contents.get(i);
        const stream = pdfDoc.context.lookup(ref, PDFStream);
        if (stream) {
          chunks.push(getDecodedStreamBytes(stream));
          chunks.push(new Uint8Array([0x0a]));
        }
      } catch {
        // Skip a chunk we can't resolve rather than losing the whole page —
        // whatever it contained just won't be covered by this pass, and the
        // caller's verification/rasterization fallback covers the gap.
      }
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  return getDecodedStreamBytes(contents);
}

/**
 * Replaces a page's content stream, and — critically — deletes the OLD
 * stream object(s) from the document's object table. pdf-lib's writer
 * serializes every object it has ever registered, reachable or not; merely
 * repointing `/Contents` leaves the original (unredacted) stream sitting in
 * the saved file as an orphaned but fully recoverable object. Without this
 * cleanup, "redaction" would be cosmetic only.
 */
function setPageContentBytes(pdfDoc: PDFDocument, page: PDFPage, bytes: Uint8Array): void {
  deleteOldContentsObjects(pdfDoc, page);
  const stream = pdfDoc.context.flateStream(bytes);
  const ref = pdfDoc.context.register(stream);
  page.node.set(PDFName.of("Contents"), ref);
}

function deleteOldContentsObjects(pdfDoc: PDFDocument, page: PDFPage): void {
  const raw = page.node.get(PDFName.of("Contents"));
  if (!raw) return;
  if (raw instanceof PDFRef) {
    pdfDoc.context.delete(raw);
  } else if (raw instanceof PDFArray) {
    for (let i = 0; i < raw.size(); i++) {
      const el = raw.get(i);
      if (el instanceof PDFRef) pdfDoc.context.delete(el);
    }
  }
}

/** Font resource names (e.g. "F1") whose bytes we should NOT try to decode as Latin-1: composite (Type0/CID) fonts, or simple fonts with a custom Differences encoding we can't confidently resolve. */
function getUnsafeFontNames(pdfDoc: PDFDocument, page: PDFPage): Set<string> {
  const unsafe = new Set<string>();
  const resources = page.node.Resources();
  const fontDict = resources?.lookup(PDFName.of("Font"), PDFDict);
  if (!fontDict) return unsafe;

  for (const [key, value] of fontDict.entries()) {
    const name = key.decodeText();
    try {
      const fontObj = value instanceof PDFDict ? value : pdfDoc.context.lookup(value, PDFDict);
      if (!fontObj) {
        unsafe.add(name);
        continue;
      }
      const subtype = fontObj.lookup(PDFName.of("Subtype"), PDFName)?.decodeText();
      if (subtype === "Type0") {
        unsafe.add(name);
        continue;
      }
      const encoding = fontObj.lookup(PDFName.of("Encoding"));
      if (encoding instanceof PDFDict && encoding.lookup(PDFName.of("Differences"))) {
        unsafe.add(name);
      }
    } catch {
      // Can't confidently resolve this font's encoding — treat it as unsafe
      // rather than risk mis-decoding its bytes.
      unsafe.add(name);
    }
  }

  return unsafe;
}
