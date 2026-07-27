import type { RawTokenClassificationResult } from "./openMedWorkerProtocol";
import type { EntityDraft } from "@/lib/regex/recognize";

// Empirically, real hits from this model land at 0.85+ and noise sits at
// 0.4-0.5 with clean separation between the two — 0.6 sits in the gap.
const CONFIDENCE_THRESHOLD = 0.6;

// How close two same-label spans can be and still be treated as one
// fragmented detection (e.g. a postal code tokenized into "100" + "21"
// instead of one "10021" span) or a chunk-overlap duplicate of the same
// value, rather than two genuinely separate entities.
const MERGE_MAX_GAP = 1;

// Raw labels are already lower_snake_case (e.g. "medical_record_number"),
// so the default is just upper-casing that — only entries that need to
// line up with THIS app's existing label conventions (for merge priority
// against regex hits, and the DATE/TIME_OF_DAY/DATE_OF_BIRTH default-accept
// split in clientProvider.ts) get an explicit override.
const LABEL_OVERRIDES: Record<string, string> = {
  medical_record_number: "MEDICAL_RECORD_NUMBER",
  ssn: "SSN",
  email: "EMAIL_ADDRESS",
  phone_number: "PHONE_NUMBER",
  fax_number: "FAX_NUMBER",
  first_name: "PERSON",
  last_name: "PERSON",
  company_name: "FACILITY_NAME",
  postcode: "ZIP_CODE",
  street_address: "ADDRESS",
  date_of_birth: "DATE_OF_BIRTH",
  date: "DATE",
  date_time: "DATE",
  time: "TIME_OF_DAY",
  credit_debit_card: "CREDIT_CARD",
};

function normalizeLabel(raw: string): string {
  return LABEL_OVERRIDES[raw] ?? raw.toUpperCase();
}

interface AbsoluteEntity {
  label: string;
  score: number;
  start: number;
  end: number;
}

/** Recovers char offsets from the aggregated word text when the tokenizer didn't attach them. */
function locateWord(text: string, word: string, searchFrom: number): { start: number; end: number } | null {
  const cleaned = word.replace(/^##/, "");
  const idx = text.indexOf(cleaned, searchFrom);
  if (idx === -1) return null;
  return { start: idx, end: idx + cleaned.length };
}

/**
 * Converts one chunk's raw model output into absolute-offset entities
 * (chunk-local start/end + this chunk's offset into the full page text),
 * applying the confidence threshold and leading-whitespace trim per span —
 * both need the chunk's own text to compute, so they happen here rather
 * than after merging across chunks.
 */
function toAbsoluteEntities(
  results: RawTokenClassificationResult[],
  chunkText: string,
  chunkOffset: number
): AbsoluteEntity[] {
  const out: AbsoluteEntity[] = [];
  let cursor = 0;

  for (const r of results) {
    if (r.score < CONFIDENCE_THRESHOLD) continue;

    let span = r.start !== undefined && r.end !== undefined ? { start: r.start, end: r.end } : null;
    if (!span) span = locateWord(chunkText, r.word, cursor);
    if (!span) continue;
    cursor = span.end;

    // Trim leading whitespace some spans carry (e.g. aggregation including
    // the separator before a word) — a space at the front of a redaction
    // span is otherwise the only part of it that visibly leaks structure.
    const { end } = span;
    let { start } = span;
    while (start < end && /\s/.test(chunkText[start])) start += 1;
    if (start >= end) continue;

    out.push({ label: normalizeLabel(r.entity_group), score: r.score, start: start + chunkOffset, end: end + chunkOffset });
  }

  return out;
}

/** Merges same-label spans that are touching/near-touching — covers both in-chunk
 * tokenizer fragmentation and duplicate detections from the chunk-overlap region. */
function mergeFragments(entities: AbsoluteEntity[]): AbsoluteEntity[] {
  const sorted = [...entities].sort((a, b) => a.start - b.start || b.score - a.score);
  const out: AbsoluteEntity[] = [];

  for (const entity of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.label === entity.label && entity.start <= prev.end + MERGE_MAX_GAP && entity.end > prev.start) {
      prev.end = Math.max(prev.end, entity.end);
      prev.score = Math.max(prev.score, entity.score);
    } else {
      out.push({ ...entity });
    }
  }

  return out;
}

/** Resolves leftover overlaps between DIFFERENT labels (rare) by keeping the higher-scoring span. */
function dedupeOverlapping(entities: AbsoluteEntity[]): AbsoluteEntity[] {
  const out: AbsoluteEntity[] = [];
  for (const entity of entities) {
    const overlapIdx = out.findIndex((k) => entity.start < k.end && entity.end > k.start);
    if (overlapIdx === -1) {
      out.push(entity);
      continue;
    }
    if (entity.score > out[overlapIdx].score) out[overlapIdx] = entity;
  }
  return out;
}

/**
 * Full post-processing pass for one page's worth of per-chunk raw model
 * output: threshold + trim (per chunk, needs chunk-local text) already
 * applied by the caller via `toAbsoluteEntities`; this combines chunks,
 * merges fragmented/duplicate spans, dedupes cross-label overlaps, and
 * slices the final entity text from the full page text.
 */
export function postProcessChunkResults(
  perChunk: { results: RawTokenClassificationResult[]; chunkText: string; chunkOffset: number }[],
  fullText: string
): EntityDraft[] {
  const absolute = perChunk.flatMap((c) => toAbsoluteEntities(c.results, c.chunkText, c.chunkOffset));
  const merged = mergeFragments(absolute);
  const deduped = dedupeOverlapping(merged);

  return deduped
    .sort((a, b) => a.start - b.start)
    .map((e) => ({
      start: e.start,
      end: e.end,
      text: fullText.slice(e.start, e.end),
      label: e.label,
      score: e.score,
      source: "ner-openmed" as const,
    }));
}
