import { findPhoneNumbersInText } from "libphonenumber-js";
import type { Entity } from "@/lib/types";
import { REGEX_RECOGNIZERS } from "./patterns";

export type EntityDraft = Omit<Entity, "id" | "page" | "accepted" | "rects">;

function hasContextNearby(
  text: string,
  matchStart: number,
  words: string[],
  window: number
): boolean {
  const windowStart = Math.max(0, matchStart - window);
  const before = text.slice(windowStart, matchStart).toLowerCase();
  return words.some((w) => before.includes(w.toLowerCase()));
}

function fromRegexRecognizers(text: string): EntityDraft[] {
  const out: EntityDraft[] = [];

  for (const recognizer of REGEX_RECOGNIZERS) {
    const re = new RegExp(recognizer.pattern.source, recognizer.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      // Guard against zero-length matches looping forever.
      if (match[0].length === 0) {
        re.lastIndex++;
        continue;
      }

      const hasGroup = match.length > 1 && match[1] !== undefined;
      const value = hasGroup ? match[1] : match[0];
      const start = hasGroup ? match.index + match[0].indexOf(match[1]) : match.index;
      const end = start + value.length;

      if (recognizer.validate && !recognizer.validate(value)) continue;

      let score = recognizer.baseScore;
      if (recognizer.contextWords) {
        const found = hasContextNearby(
          text,
          match.index,
          recognizer.contextWords,
          recognizer.contextWindow ?? 30
        );
        if (recognizer.requiresContext && !found) continue;
        if (found) score = Math.min(0.99, score + 0.15);
      }

      const isDob =
        recognizer.label === "DATE" &&
        recognizer.contextWords &&
        hasContextNearby(text, match.index, recognizer.contextWords, recognizer.contextWindow ?? 25);

      out.push({
        start,
        end,
        text: value,
        label: isDob ? "DATE_OF_BIRTH" : recognizer.label,
        score,
        source: "regex",
      });
    }
  }

  return out;
}

const FAX_CONTEXT_WINDOW = 20;
const FAX_KEYWORDS = ["fax"];

function fromPhoneNumbers(text: string): EntityDraft[] {
  const found = findPhoneNumbersInText(text, "US");
  return found.map(({ startsAt, endsAt }) => {
    const isFax = hasContextNearby(text, startsAt, FAX_KEYWORDS, FAX_CONTEXT_WINDOW);
    return {
      start: startsAt,
      end: endsAt,
      text: text.slice(startsAt, endsAt),
      label: isFax ? "FAX_NUMBER" : "PHONE_NUMBER",
      score: 0.9,
      source: "regex" as const,
    };
  });
}

/** Deterministic, high-precision PII detection: regex + checksum + libphonenumber-js. No ML involved. */
export function detectRegexEntities(text: string): EntityDraft[] {
  return [...fromRegexRecognizers(text), ...fromPhoneNumbers(text)];
}
