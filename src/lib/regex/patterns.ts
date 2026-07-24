import { passesLuhn } from "./luhn";
import { isValidSsnStructure } from "./ssnValidate";
import { hasSubstantialAccessionSuffix } from "./accessionValidate";

export interface RegexRecognizer {
  label: string;
  /** Must be a `g` (global) regex. If it has a capture group, group 1 is the redacted span; otherwise the whole match is. */
  pattern: RegExp;
  baseScore: number;
  /** Case-insensitive keywords that, if found within `contextWindow` chars before the match, confirm/boost it. */
  contextWords?: string[];
  contextWindow?: number;
  /** If true, the match is dropped entirely when no context keyword is found nearby (used for ambiguous formats). */
  requiresContext?: boolean;
  /** Extra validation on the matched text, e.g. a Luhn checksum. */
  validate?: (matchText: string) => boolean;
}

/**
 * Ported from the shape of Presidio's built-in pattern recognizers so the
 * client and server pipelines detect the same deterministic PII with the
 * same label set. MRN/account/license formats are hospital- and
 * institution-specific — the context-gated patterns below are a reasonable
 * general default; confirm against the client's actual formats and tighten
 * as needed.
 */
export const REGEX_RECOGNIZERS: RegexRecognizer[] = [
  {
    label: "EMAIL_ADDRESS",
    pattern:
      /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g,
    baseScore: 0.95,
  },
  {
    label: "URL",
    pattern: /\bhttps?:\/\/[^\s<>"')\]]+/gi,
    baseScore: 0.9,
  },
  {
    // Scheme-less domains ("www.example.com") are common in printed reports
    // (letterhead, footers) but not covered by the scheme-required pattern
    // above. Restricted to a `www.` prefix (rather than matching any bare
    // TLD-looking word) to avoid flagging ordinary abbreviations/filenames.
    label: "URL",
    pattern: /\bwww\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?:\/[^\s<>"')\]]*)?/gi,
    baseScore: 0.8,
  },
  {
    label: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    baseScore: 0.85,
    contextWords: ["ssn", "social security"],
    contextWindow: 30,
    validate: isValidSsnStructure,
  },
  {
    label: "SSN",
    // Bare 9-digit SSNs are indistinguishable from other IDs without context.
    pattern: /\b\d{9}\b/g,
    baseScore: 0.4,
    contextWords: ["ssn", "social security"],
    contextWindow: 30,
    requiresContext: true,
    validate: isValidSsnStructure,
  },
  {
    label: "CREDIT_CARD",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    baseScore: 0.9,
    validate: passesLuhn,
  },
  {
    label: "IP_ADDRESS",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
    baseScore: 0.85,
  },
  {
    label: "IP_ADDRESS",
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b/g,
    baseScore: 0.75,
  },
  {
    label: "ZIP_CODE",
    // 5-digit numbers are extremely ambiguous on their own.
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
    baseScore: 0.4,
    contextWords: ["zip", "zip code", "address", "state", "city"],
    contextWindow: 40,
    requiresContext: true,
  },
  {
    label: "DATE",
    pattern:
      /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+\d{4})\b/gi,
    baseScore: 0.75,
    contextWords: ["dob", "date of birth", "birth date", "born"],
    contextWindow: 25,
  },
  {
    label: "MEDICAL_RECORD_NUMBER",
    // [A-Z0-9-] (not just [A-Z0-9]): real MRNs are often prefixed, e.g.
    // "HRC-0447192" — without the hyphen this silently failed to match at
    // all (too short once the pattern cut off after the prefix).
    pattern:
      /(?:\bMRN\b|\bMR\s*#|\bMedical\s+Record(?:\s+Number)?\b|\bPatient\s+ID\b|\bChart\s*#)\s*[:#-]?\s*([A-Z0-9-]{5,15})\b/gi,
    baseScore: 0.9,
  },
  {
    label: "ACCOUNT_NUMBER",
    pattern:
      /(?:\bAccount\s*(?:No\.?|Number|#)|\bAcct\.?\s*(?:No\.?|#)?)\s*[:#-]?\s*(\d{6,17})\b/gi,
    baseScore: 0.85,
  },
  {
    label: "LICENSE_NUMBER",
    pattern:
      /(?:\bDriver'?s?\s+License\b|\bDL\s*#|\bLicense\s*(?:No\.?|Number|#))\s*[:#-]?\s*([A-Z0-9-]{5,15})\b/gi,
    baseScore: 0.85,
  },
  {
    // Radiology/imaging reports identify the study by accession number the
    // same way encounters use an MRN — same PII sensitivity, same treatment.
    // "Accession" no longer requires a No./Number/# qualifier ("Path
    // Accession S22-014728" has none), and "Path Accession" is matched
    // directly since "Path" alone isn't a safe generic trigger word.
    label: "ACCESSION_NUMBER",
    pattern:
      /(?:\bPath\s+Accession\b|\bAccession\s*(?:No\.?|Number|#)?|\bAcc\.?\s*#)\s*[:#-]?\s*([A-Z0-9-]{5,20})\b/gi,
    baseScore: 0.9,
  },
  {
    // Value-shape fallback: institution accession/study codes (e.g.
    // "RAD22-MR-02219", "LAB22-338207") often sit next to a label word
    // ("Imaging", a bare section header, ...) too generic to safely trigger
    // on by itself. The shape — short uppercase prefix + 2-digit year +
    // 1-3 hyphenated alphanumeric groups — is distinctive enough to catch
    // on its own. Requires digits immediately after the letters, so it
    // doesn't collide with hyphen-prefixed IDs like "HRC-0447192" (MRN).
    label: "ACCESSION_NUMBER",
    pattern: /\b[A-Z]{1,4}\d{2}(?:-[A-Z0-9]{1,6}){1,3}\b/g,
    baseScore: 0.6,
    validate: hasSubstantialAccessionSuffix,
  },
  {
    label: "AGE",
    pattern: /\bAge\s*:\s*(\d{1,3})\b/gi,
    baseScore: 0.6,
  },
  {
    // Combined "DOB / Age / Sex: 1969-03-14 / 53 / Female" header — the age
    // value has no label of its own, so the preceding date+slash is matched
    // as non-captured context to anchor position (single-capture-group
    // architecture can't pull all three fields out of one match).
    label: "AGE",
    pattern: /\bDOB\s*\/\s*Age\s*\/\s*Sex\s*:?\s*[\d/-]+\s*\/\s*(\d{1,3})\b/gi,
    baseScore: 0.7,
  },
  {
    label: "GENDER",
    pattern: /\b(?:Gender|Sex)\s*:\s*(Male|Female|M|F|Other|Non-binary)\b/gi,
    baseScore: 0.6,
  },
  {
    label: "GENDER",
    pattern:
      /\bDOB\s*\/\s*Age\s*\/\s*Sex\s*:?\s*[\d/-]+\s*\/\s*\d{1,3}\s*\/\s*(Male|Female|M|F|Other|Non-binary)\b/gi,
    baseScore: 0.7,
  },
  {
    label: "ADDRESS",
    pattern:
      /(?:\bHome\s+Address\b|\bMailing\s+Address\b|\bAddress\b)\s*:\s*([A-Za-z0-9][^\n]{4,80})/gi,
    baseScore: 0.6,
  },
  {
    label: "TIME_OF_DAY",
    // Combined with a DATE match immediately before it in report headers
    // ("2022-10-15 11:40"), but kept as its own entity/pattern rather than
    // folded into DATE's capture group.
    pattern: /\b([01]?\d|2[0-3]):[0-5]\d\b/g,
    baseScore: 0.45,
  },
  {
    label: "FACILITY_NAME",
    // Capped leading run of capitalized words (1-4) so this can't sweep up
    // an entire preceding sentence before hitting a facility-type suffix.
    pattern: /\b(?:[A-Z][a-zA-Z]*\s+){1,4}(?:Centre|Center|Hospital|Clinic)\b/g,
    baseScore: 0.55,
  },
  {
    label: "FACILITY_NAME",
    pattern:
      /\bDepartment\s+of\s+[A-Z][a-zA-Z]+(?:\s*(?:&|and)\s*[A-Z][a-zA-Z]+)*(?:\s+Medicine)?\b/g,
    baseScore: 0.5,
  },
  {
    // Trailing credential/specialty block after a physician's name, e.g.
    // "Priya Raman, MD, FRCPC (Medical Oncology)" — PHYSICIAN_NAME
    // deliberately stops before this (see its comment), so this is a
    // separate entity covering just the credentials portion.
    label: "PHYSICIAN_CREDENTIALS",
    pattern:
      /\b(?:MD|DO|RN|NP)\s*,\s*[A-Z]{2,8}(?:\s*\(\s*[A-Z][a-zA-Z]+(?:\s+[A-Z&][a-zA-Z]*)*\s*\))?/g,
    baseScore: 0.55,
  },
  // Names are unstructured, so NER is the primary way to catch them — but a
  // clearly labeled field ("Patient:", "Referring Physician:", ...) is a
  // deterministic, high-precision signal that shouldn't depend on an NER
  // model being loaded at all. These patterns catch "Last, First" (the
  // common patient-header convention) and "First Last[, credentials]"
  // (the common provider-signature convention), stopping naturally at the
  // first comma/lowercase word so trailing credentials (", MD, FRCSC") or
  // sentence continuation aren't swept in.
  //
  // Two guards on each continuation word:
  //  - `\b(?!\s*:)` rejects the next line's field label when it's a single
  //    capitalized word directly followed by a colon (e.g. "Emily
  //    Carter\nPhone:" — without it, "Phone" reads like a 3rd name word).
  //    The `\b` matters: a bare `(?!\s*:)` lets the engine backtrack the
  //    word short (e.g. to "Phon") to dodge the lookahead and still match;
  //    `\b` forces the check at the word's actual end, so the whole
  //    continuation is rejected instead of truncated.
  //  - The separator itself only allows same-line whitespace or a SINGLE
  //    newline (`\n(?![ \t]*\n)`), not a blank-line paragraph gap — without
  //    this, a new paragraph's capitalized first word (e.g. "cc: Dr. Harold
  //    Bennett\n\nThis report was reviewed...") reads as a 3rd name word.
  // Capping at 2 continuations (max 3 words) covers "First Middle Last"
  // while limiting how far a false continuation can reach either way.
  {
    label: "PATIENT_NAME",
    pattern:
      /\bPatient(?:\s*Name)?\s*:\s*([A-Z][a-zA-Z'-]*\.?(?:\s*,\s*[A-Z][a-zA-Z'-]*\.?|(?:(?:[ \t]+|\n(?![ \t]*\n))[A-Z][a-zA-Z'-]*\.?\b(?!\s*:)){1,2}))/g,
    baseScore: 0.85,
  },
  {
    label: "PHYSICIAN_NAME",
    // No `i` flag: under `/i`, `[A-Z]` in the capture group would match
    // lowercase letters too, defeating the "stop at the next lowercase
    // word" boundary check and swallowing following sentence text (e.g.
    // "Nurse Angela Rivera provided care" -> capturing "Angela Rivera
    // provided care"). Label alternatives are written in the capitalized
    // form they actually appear in on real reports; "cc" stays lowercase.
    // See the PATIENT_NAME comment above for the continuation-word guards.
    pattern:
      /(?:\bReferring\s*\/?\s*Family\s*MD\b|\bReferring\s+Physician\b|\bOrdering\s+Physician\b|\bAttending\s+Physician\b|\bReading\s+Radiologist\b|\bRadiologist\b|\bPathologist\b|\bElectronically\s+[Ss]igned(?:\s+[Bb]y)?\b|\bSigned\s+by\b|\bcc\b|\bNurse\b)\s*:?\s*(?:Dr\.?\s+)?([A-Z][a-zA-Z'-]*\.?(?:(?:[ \t]+|\n(?![ \t]*\n))[A-Z][a-zA-Z'-]*\.?\b(?!\s*:)){1,2})/g,
    baseScore: 0.85,
  },
];
