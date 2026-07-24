/**
 * A minimal PDF content-stream scanner — enough to locate text-showing
 * operators (Tj, TJ, ', ") and the exact byte ranges of their string
 * operands, without needing a full PDF object parser (content streams have
 * no indirect references, so a simple operand/operator scan is sufficient).
 *
 * This intentionally does NOT reconstruct/re-serialize the stream. Callers
 * get back byte ranges into the ORIGINAL buffer so they can patch specific
 * string contents in place (same length, so nothing else in the stream or
 * file has to shift) rather than rebuilding the stream from an AST — that
 * sidesteps a whole class of "reformatted something subtly wrong" bugs.
 */

export interface ByteRange {
  /** Byte offset of the first content byte (inside the string's delimiters). */
  start: number;
  /** Byte offset one past the last content byte. */
  end: number;
  kind: "literal" | "hex";
}

export interface StringOperand {
  range: ByteRange;
  /** Decoded bytes (escapes resolved for literal strings; hex pairs decoded for hex strings). */
  bytes: Uint8Array;
  /** Name of the font active via the most recent `Tf` operator, or null if none seen yet. */
  fontName: string | null;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]); // ( ) < > [ ] { } / %

function isWhitespace(b: number): boolean {
  return WHITESPACE.has(b);
}
function isDelimiter(b: number): boolean {
  return DELIMITERS.has(b);
}
function isRegular(b: number): boolean {
  return !isWhitespace(b) && !isDelimiter(b);
}

/** Decodes a PDF literal string's content bytes (escapes resolved) to raw character codes. */
function decodeLiteralString(bytes: Uint8Array, start: number, end: number): Uint8Array {
  const out: number[] = [];
  let i = start;
  while (i < end) {
    const b = bytes[i];
    if (b === 0x5c /* backslash */ && i + 1 < end) {
      const next = bytes[i + 1];
      switch (next) {
        case 0x6e: // n
          out.push(0x0a);
          i += 2;
          break;
        case 0x72: // r
          out.push(0x0d);
          i += 2;
          break;
        case 0x74: // t
          out.push(0x09);
          i += 2;
          break;
        case 0x62: // b
          out.push(0x08);
          i += 2;
          break;
        case 0x66: // f
          out.push(0x0c);
          i += 2;
          break;
        case 0x28: // (
        case 0x29: // )
        case 0x5c: // backslash
          out.push(next);
          i += 2;
          break;
        case 0x0a:
          i += 2; // line continuation, no output
          break;
        case 0x0d:
          i += bytes[i + 2] === 0x0a ? 3 : 2;
          break;
        default:
          if (next >= 0x30 && next <= 0x37) {
            // up to 3 octal digits
            let val = 0;
            let j = i + 1;
            let count = 0;
            while (count < 3 && j < end && bytes[j] >= 0x30 && bytes[j] <= 0x37) {
              val = val * 8 + (bytes[j] - 0x30);
              j += 1;
              count += 1;
            }
            out.push(val & 0xff);
            i = j;
          } else {
            out.push(next);
            i += 2;
          }
      }
    } else {
      out.push(b);
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

function decodeHexString(bytes: Uint8Array, start: number, end: number): Uint8Array {
  const digits: number[] = [];
  for (let i = start; i < end; i++) {
    const b = bytes[i];
    const isHexDigit = (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);
    if (isHexDigit) digits.push(b);
  }
  if (digits.length % 2 === 1) digits.push(0x30); // trailing odd digit padded with 0, per spec
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = parseInt(String.fromCharCode(digits[i * 2]), 16);
    const lo = parseInt(String.fromCharCode(digits[i * 2 + 1]), 16);
    out[i] = hi * 16 + lo;
  }
  return out;
}

type Operand =
  | { type: "string"; range: ByteRange }
  | { type: "name"; value: string }
  | { type: "number"; value: number }
  | { type: "array"; elements: Operand[] }
  | { type: "other" }
  | { type: "keyword"; value: string };

export interface TextShowEvent {
  operator: "Tj" | "'" | '"' | "TJ";
  strings: StringOperand[];
}

/**
 * Scans a content stream and returns, in document order, every string
 * operand passed to a text-showing operator, tagged with the font active at
 * that point (per the most recent `Tf`).
 */
export function scanTextShowOperators(bytes: Uint8Array): TextShowEvent[] {
  const events: TextShowEvent[] = [];
  let currentFont: string | null = null;
  let operandStack: Operand[] = [];
  const len = bytes.length;
  let i = 0;

  function readString(): Operand {
    const open = bytes[i];
    if (open === 0x28) {
      // literal string, track balanced (unescaped) parens
      const contentStart = i + 1;
      let depth = 1;
      let j = contentStart;
      while (j < len && depth > 0) {
        const b = bytes[j];
        if (b === 0x5c) {
          j += 2;
          continue;
        }
        if (b === 0x28) depth += 1;
        else if (b === 0x29) depth -= 1;
        j += 1;
      }
      const contentEnd = j - 1;
      i = j;
      return { type: "string", range: { start: contentStart, end: contentEnd, kind: "literal" } };
    } else {
      // hex string
      const contentStart = i + 1;
      let j = contentStart;
      while (j < len && bytes[j] !== 0x3e) j += 1;
      const contentEnd = j;
      i = j + 1;
      return { type: "string", range: { start: contentStart, end: contentEnd, kind: "hex" } };
    }
  }

  function readName(): Operand {
    const start = i + 1;
    let j = start;
    while (j < len && isRegular(bytes[j])) j += 1;
    i = j;
    return { type: "name", value: new TextDecoder("latin1").decode(bytes.subarray(start, j)) };
  }

  function readNumberOrKeyword(): Operand {
    const start = i;
    let j = i;
    while (j < len && isRegular(bytes[j])) j += 1;
    i = j;
    const raw = new TextDecoder("latin1").decode(bytes.subarray(start, j));
    const num = Number(raw);
    if (!Number.isNaN(num) && /^[+-]?[0-9.]+$/.test(raw)) {
      return { type: "number", value: num };
    }
    return { type: "keyword", value: raw };
  }

  function readArray(): Operand {
    i += 1; // skip [
    const elements: Operand[] = [];
    for (;;) {
      while (i < len && isWhitespace(bytes[i])) i += 1;
      if (i >= len || bytes[i] === 0x5d) {
        i += 1;
        break;
      }
      elements.push(readOperand());
    }
    return { type: "array", elements };
  }

  function readOperand(): Operand {
    const b = bytes[i];
    if (b === 0x28 || b === 0x3c) {
      // could be hex string `<...>` or dict `<<...>>`
      if (b === 0x3c && bytes[i + 1] === 0x3c) {
        // dictionary operand (e.g. inline image dict, or marked-content props) — skip generically
        i += 2;
        let depth = 1;
        while (i < len && depth > 0) {
          if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
            depth += 1;
            i += 2;
          } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
            depth -= 1;
            i += 2;
          } else {
            i += 1;
          }
        }
        return { type: "other" };
      }
      return readString();
    }
    if (b === 0x2f) return readName();
    if (b === 0x5b) return readArray();
    return readNumberOrKeyword();
  }

  while (i < len) {
    const b = bytes[i];

    if (isWhitespace(b)) {
      i += 1;
      continue;
    }
    if (b === 0x25 /* % comment */) {
      while (i < len && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
      continue;
    }

    const before = i;
    const operand = readOperand();

    if ("type" in operand && operand.type === "keyword") {
      const op = operand.value;

      if (op === "Tf" && operandStack.length >= 1) {
        const fontOperand = operandStack[operandStack.length - 2];
        if (fontOperand && fontOperand.type === "name") currentFont = fontOperand.value;
      } else if (op === "Tj" || op === "'" || op === '"') {
        const strOperand = [...operandStack].reverse().find((o) => o.type === "string");
        if (strOperand && strOperand.type === "string") {
          events.push({
            operator: op,
            strings: [toStringOperand(bytes, strOperand.range, currentFont)],
          });
        }
      } else if (op === "TJ") {
        const arrOperand = [...operandStack].reverse().find((o) => o.type === "array");
        if (arrOperand && arrOperand.type === "array") {
          const strings = arrOperand.elements
            .filter((el): el is Extract<Operand, { type: "string" }> => el.type === "string")
            .map((el) => toStringOperand(bytes, el.range, currentFont));
          if (strings.length > 0) events.push({ operator: "TJ", strings });
        }
      } else if (op === "BI") {
        // Inline image: opaque binary blob between `ID` and `EI`. Skip it so
        // we never mis-tokenize raw image bytes as PDF syntax.
        const idIdx = findKeyword(bytes, i, "ID");
        if (idIdx !== -1) {
          let scan = idIdx + 2;
          if (scan < len && isWhitespace(bytes[scan])) scan += 1;
          const eiIdx = findKeyword(bytes, scan, "EI");
          i = eiIdx !== -1 ? eiIdx + 2 : len;
        }
      }

      operandStack = [];
    } else {
      operandStack.push(operand);
    }

    if (i === before) i += 1; // safety net against infinite loops on unexpected bytes
  }

  return events;
}

function toStringOperand(bytes: Uint8Array, range: ByteRange, fontName: string | null): StringOperand {
  const decoded =
    range.kind === "literal"
      ? decodeLiteralString(bytes, range.start, range.end)
      : decodeHexString(bytes, range.start, range.end);
  return { range, bytes: decoded, fontName };
}

function findKeyword(bytes: Uint8Array, from: number, keyword: string): number {
  const target = keyword.split("").map((c) => c.charCodeAt(0));
  for (let i = from; i <= bytes.length - target.length; i++) {
    let match = true;
    for (let k = 0; k < target.length; k++) {
      if (bytes[i + k] !== target[k]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}
