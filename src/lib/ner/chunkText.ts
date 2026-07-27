/**
 * Splits page text into overlapping word-budget chunks for OpenMed's
 * token-classification model, which silently truncates anything past its
 * ~512-token window (no error — text past that point just returns zero
 * entities). ~400 words keeps real reports comfortably under that budget
 * even accounting for subword tokenization; ~50-word overlap means a value
 * sitting right at a chunk boundary still gets a full pass from whichever
 * chunk it lands in.
 *
 * Boundaries are always snapped to a LINE start, never mid-line: these
 * reports put "Label: Value" pairs (MRN, accession number, ...) on a single
 * line, so cutting mid-line was what caused the label and its value to end
 * up in different chunks — the value then has no label text right before
 * it for the model to key off, which is what caused the MRN regression.
 */

export interface TextChunk {
  text: string;
  /** Absolute char offset of `text[0]` within the original page text. */
  offset: number;
}

const CHUNK_WORD_TARGET = 400;
const CHUNK_OVERLAP_WORDS = 50;

function countWords(line: string): number {
  const trimmed = line.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function chunkText(text: string): TextChunk[] {
  if (!text.trim()) return [];

  const lines: { start: number; wordCount: number }[] = [];
  let cursor = 0;
  for (const raw of text.split("\n")) {
    lines.push({ start: cursor, wordCount: countWords(raw) });
    cursor += raw.length + 1; // +1 for the newline consumed by split("\n")
  }

  // Whole text fits in one chunk — the overwhelmingly common case for a
  // single report page — skip the chunking machinery entirely.
  const totalWords = lines.reduce((sum, l) => sum + l.wordCount, 0);
  if (totalWords <= CHUNK_WORD_TARGET) {
    return [{ text, offset: 0 }];
  }

  const chunks: TextChunk[] = [];
  let lineIdx = 0;

  while (lineIdx < lines.length) {
    const chunkStartLine = lineIdx;
    let wordCount = 0;
    // Always include at least one line, even if it alone exceeds the
    // target, so a single very long line can't stall progress forever.
    while (lineIdx < lines.length && (wordCount === 0 || wordCount < CHUNK_WORD_TARGET)) {
      wordCount += lines[lineIdx].wordCount;
      lineIdx += 1;
    }

    const startOffset = lines[chunkStartLine].start;
    const endOffset = lineIdx < lines.length ? lines[lineIdx].start : text.length;
    chunks.push({ text: text.slice(startOffset, endOffset), offset: startOffset });

    if (lineIdx >= lines.length) break;

    // Back up by ~CHUNK_OVERLAP_WORDS worth of lines for the next chunk's
    // overlap, but never less than one line of forward progress.
    let overlapWords = 0;
    let backIdx = lineIdx;
    while (backIdx > chunkStartLine && overlapWords < CHUNK_OVERLAP_WORDS) {
      backIdx -= 1;
      overlapWords += lines[backIdx].wordCount;
    }
    lineIdx = Math.max(backIdx, chunkStartLine + 1);
  }

  return chunks;
}
