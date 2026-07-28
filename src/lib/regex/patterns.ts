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
    contextWords: ["ssn", "social security",  "ssn#", "soc sec"],
    contextWindow: 30,
    validate: isValidSsnStructure,
  },
  {
    label: "SSN",
    // Bare 9-digit SSNs are indistinguishable from other IDs without context.
    pattern: /\b\d{9}\b/g,
    baseScore: 0.4,
    contextWords: ["ssn", "social security",  "ssn#", "soc sec"],
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
    // Hyphenated segments allow SPACE around the hyphen (`\s*-\s*`), not
    // just a bare hyphen: PDF text extraction sometimes renders a styled ID
    // like "MT-2026-04471" as "MT - 2026 - 04471" (each segment a separate
    // positioned run) — a plain [A-Z0-9-]{5,15} character class doesn't
    // include spaces, so it silently cut off after just "MT" and missed
    // the value entirely. Segmented form covers both spaced and unspaced.
    // Label alternatives cover common synonyms real reports use for the
    // same field (MRN / MR#/No / Medical Record (Number/No) / Med Rec# /
    // Patient ID / Patient Record Number / Chart #/No / Hospital Number).
    pattern:
      /(?:\bMRN\b|\bMR\s*(?:#|No\.?)|\bMedical\s+Record(?:\s+(?:Number|No\.?))?\b|\bMed\s*Rec\s*#|\bPatient\s+ID\b|\bPatient\s+Record\s+Number\b|\bChart\s*(?:#|No\.?)|\bHosp(?:ital)?\s*(?:Number|No\.?|#))\s*[:#-]?\s*([A-Z0-9]{2,10}(?:\s*-\s*[A-Z0-9]{1,10}){0,4})\b/gi,
    baseScore: 0.9,
  },
  {
    label: "ACCOUNT_NUMBER",
    pattern:
      /(?:\bAccount\s*(?:No\.?|Number|ID|#)|\bAcct\.?\s*(?:No\.?|#)?|\bBilling\s+Account\s*(?:No\.?|Number|#)?)\s*[:#-]?\s*(\d{6,17})\b/gi,
    baseScore: 0.85,
  },
  {
    label: "LICENSE_NUMBER",
    // See MEDICAL_RECORD_NUMBER above: segments allow SPACE around the
    // hyphen, since PDF text extraction sometimes renders a styled ID with
    // each segment as a separate positioned run ("D - 123 - 4567"). First
    // segment allows a single character (unlike MRN's 2+): many US state
    // license formats start with just one letter (e.g. "D1234567").
    //
    // No `i` flag (unlike the other ID-style recognizers above): under
    // `/i`, `\bDL\b` also matches the lab-value unit "dL" (deciliter, as in
    // "mg/dL" — extremely common in any lab report), and `No\.?` right
    // after it then matches the start of the word "Normal", with the
    // case-insensitive `[A-Z0-9]` capture group happily grabbing the
    // lowercase leftover "rmal" as a fake "license number" — which then
    // gets multiplied across every other "Normal" cell in the report by
    // occurrence expansion. Real license labels ("License", "Driver's
    // License") are consistently capitalized in these reports, so losing
    // hypothetical all-lowercase label variants costs far less than this
    // false-positive did. Same bug class already fixed in PHYSICIAN_NAME
    // above for the same reason (see its comment).
    pattern:
      /(?:\bDriver'?s?\s+License\b|\bDL\s*(?:#|No\.?)|\bLicense\s*(?:No\.?|Number|ID|#))\s*[:#-]?\s*([A-Z0-9]{1,10}(?:\s*-\s*[A-Z0-9]{1,10}){0,4})\b/g,
    baseScore: 0.85,
  },
  {
    // Radiology/imaging reports identify the study by accession number the
    // same way encounters use an MRN — same PII sensitivity, same treatment.
    // "Accession" no longer requires a No./Number/# qualifier ("Path
    // Accession S22-014728" has none), and "Path Accession" is matched
    // directly since "Path" alone isn't a safe generic trigger word.
    // Study/Case/Specimen Number-ID cover the same field under the label
    // convention radiology/pathology/lab reports each tend to use instead.
    // Segments allow SPACE around the hyphen, same reason as
    // MEDICAL_RECORD_NUMBER above (e.g. "LAB-2026-22190" extracted as
    // "LAB - 2026 - 22190" — this is what silently dropped the whole value
    // before, since the value stopped at "LAB" and never reached the rest).
    label: "ACCESSION_NUMBER",
    pattern:
      /(?:\bPath\s+Accession\b|\bAccession\s*(?:No\.?|Number|ID|#)?|\bAcc\.?\s*#|\bStudy\s*(?:No\.?|Number|ID)\b|\bCase\s*(?:No\.?|Number)\b|\bSpecimen\s*(?:No\.?|Number|ID)\b)\s*[:#-]?\s*([A-Z0-9]{2,10}(?:\s*-\s*[A-Z0-9]{1,10}){0,4})\b/gi,
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
    // Hyphens allow surrounding space for the same extraction-spacing
    // reason as MEDICAL_RECORD_NUMBER above.
    label: "ACCESSION_NUMBER",
    pattern: /\b[A-Z]{1,4}\d{2}(?:\s*-\s*[A-Z0-9]{1,6}){1,3}\b/g,
    baseScore: 0.6,
    validate: hasSubstantialAccessionSuffix,
  },
  {
    // Generic catch-all for ANY "Label: value" field whose label ends in an
    // identifier-suggestive word — not a fixed list of exact label phrases
    // like the recognizers above. This is what covers a label we haven't
    // seen before ("Report ID", "Source Block", ...): as long as the label
    // ends in one of these nouns, it's caught and the FULL value is
    // captured, without needing that exact phrase added by name.
    //
    // The separator after the label can be a colon OR just a wide gap with
    // no colon at all (`(?:\s*:\s*|\s{2,})`) — some table layouts render a
    // bold label next to its value with nothing but cell-gap whitespace
    // between them (e.g. "MRN   MT-2026-04471", no colon anywhere). Note
    // `\b\.?` (not `\.?\b`) before that: an abbreviation like "No." sits
    // between two non-word characters once the period is included (the
    // period itself, then trailing whitespace), so a `\b` check placed
    // right after the period never matches — same class of bug as the
    // physician/patient-name continuation fix elsewhere in this file.
    // Checking the boundary on the word itself, then consuming the period
    // unconditionally after, avoids that.
    //
    // The value is captured lazily up to end-of-line, OR up to whatever
    // looks like the START OF THE NEXT LABEL — deliberately NOT "does the
    // next thing match one of these specific label shapes" (Title Case?
    // all-caps? "Date of Birth" has a lowercase "of"...), since we can't
    // enumerate every label format any more than we can enumerate every
    // label NAME. Instead this checks purely STRUCTURAL signals true of
    // any label regardless of wording: either a short run of non-colon
    // tokens (treating "/" as a joiner, not its own token, so "DOB / Age /
    // Sex" counts as 3 tokens, not 5) immediately followed by a colon, OR
    // — for the no-colon table layout — a wide gap immediately followed by
    // a capitalized word (the next bold label cell). Also NOT just "2+
    // spaces" on its own: a value can itself be rendered with wide internal
    // letter-spacing by the PDF ("ODX  2213087" as ONE value, not two
    // fields), which a fixed space-count alone can't tell apart from an
    // actual next-field gap — checking what FOLLOWS the gap is what makes
    // the stopping decision correct either way. This is what fixes a field
    // being only PARTIALLY redacted (e.g. "Report ID: ODX2213087" leaving
    // "ODX" visible) — this is a deliberately loose net; the label-anchored
    // recognizers above still win on precision/labeling where they apply,
    // this is the fallback for everything else.
    //
    // Token definition excludes "(" and ")": a value can carry its own
    // trailing parenthetical annotation (e.g. "Linked Case: S24-006815
    // (liver core biopsy)"), and a short phrase like that can otherwise
    // fit within the "few tokens then a colon" allowance above — parens
    // never appear in an actual field label, so excluding them means no
    // position inside a parenthetical can ever complete the "next label"
    // token run, and the capture correctly runs through the whole
    // annotation instead of stopping partway into it.
    //
    // "Reference"/"Ref" require a "Number"/"No" qualifier (unlike the other
    // keywords, which stand alone) — a BARE "Reference" is a near-universal
    // lab-report column header (short for "Reference Range/Interval"), not
    // an identifier label on its own. Without the qualifier, a table header
    // row like "Test   Result   Reference   Flag" was read as label
    // "Reference" / value "Flag", redacting the word "Flag" as if it were
    // PII. "Reference Number:"/"Ref No.:" (an actual ID field) still match
    // fine since the qualifier is required right there anyway.
    label: "IDENTIFIER",
    pattern:
      /\b(?:[A-Z][a-zA-Z]*\s+){0,3}(?:IDs?|Nos?|Numbers?|Codes?|Blocks?|Records?|Reference\s+Numbers?|Ref\s*Nos?|Identifiers?|Accessions?|Barcodes?|Serials?|Charts?|Cases?|Slides?|Cassettes?|Batch(?:es)?|Lots?)\b\.?(?:\s*:\s*|\s{2,})([A-Za-z0-9][^\n]*?)(?=\s+(?:[^\s:/()\n]+(?:\s+|\s*\/\s*)){0,3}[^\s:/()\n]+\s*:|\s{2,}[A-Z]|\n|$)/g,
    baseScore: 0.7,
  },
  {
    label: "AGE",
    pattern: /\b(?:Patient\s+)?Age\s*:\s*(\d{1,3})\b/gi,
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
    pattern:
      /\b(?:Gender|Sex|Sex\s*\/\s*Gender|Patient\s+Sex|Biological\s+Sex)\s*:\s*(Male|Female|M|F|Other|Non-binary)\b/gi,
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
      /(?:\bHome\s+Address\b|\bMailing\s+Address\b|\bResidential\s+Address\b|\bStreet\s+Address\b|\bPatient\s+Address\b|\bCurrent\s+Address\b|\bAddress\b)\s*:\s*([A-Za-z0-9][^\n]{4,80})/gi,
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
  //  - `\b(?!\s*[:/])` rejects the next line's field label when it's a
  //    single capitalized word directly followed by a colon (e.g. "Emily
  //    Carter\nPhone:" — without it, "Phone" reads like a 3rd name word),
  //    or by a slash (e.g. "...Rose\nDOB / Age / Sex:" — a compound label
  //    whose own colon is several words away, so a bare `:` check alone
  //    doesn't catch it; "/" is a strong enough signal on its own here
  //    since it never appears within a real name).
  //    The `\b` matters: a bare `(?!\s*[:/])` lets the engine backtrack the
  //    word short (e.g. to "Phon") to dodge the lookahead and still match;
  //    `\b` forces the check at the word's actual end, so the whole
  //    continuation is rejected instead of truncated.
  //    Order matters too: `\b(?!\s*[:/])\.?` (boundary+lookahead BEFORE the
  //    optional trailing period), not `\.?\b(?!\s*:)` — a middle initial
  //    like "J." sits between two non-word characters once the period is
  //    included (the period itself, then trailing whitespace), so `\b`
  //    right after the period never matches and the engine backtracks to
  //    leave the period unconsumed. That unconsumed "." then has no
  //    leading whitespace before it for the NEXT continuation word to
  //    anchor on, silently truncating "Robert J. Callahan" to "Robert J"
  //    and dropping the actual last name. Checking `\b` on the word body
  //    first, then consuming the period unconditionally after, avoids this.
  //  - The separator itself only allows same-line whitespace or a SINGLE
  //    newline (`\n(?![ \t]*\n)`), not a blank-line paragraph gap — without
  //    this, a new paragraph's capitalized first word (e.g. "cc: Dr. Harold
  //    Bennett\n\nThis report was reviewed...") reads as a 3rd name word.
  //    Same-line whitespace is also capped at 1-2 chars (`[ \t]{1,2}`, not
  //    `[ \t]+`): a table layout's next COLUMN label ("Patient" | "Donnelly,
  //    Katherine R." | "Accession" | "PET24-03388") has no colon or slash
  //    after it either — it's a bare word followed by its own value, same
  //    as "Patient"/"MRN" themselves in this style of report — so the
  //    `(?!\s*[:/])` guard alone doesn't reject it. What's different is the
  //    GAP: a table's column gap is 3+ spaces, a real word-separator within
  //    a name is exactly one. Capping the separator at 2 chars means a
  //    continuation attempt across a wide column gap can never even start,
  //    so "Accession" can't be swept into "Donnelly, Katherine R." as a 3rd
  //    name word regardless of what character (if any) follows it.
  // Capping at 2 continuations (max 3 words) covers "First Middle Last"
  // while limiting how far a false continuation can reach either way.
  {
    // The "Last, First" branch used to allow only ONE word after the
    // comma, so "Beaumont, Diane Rose" (Last, First Middle) matched just
    // "Beaumont, Diane" and left "Rose" behind. It now allows up to 2
    // more space-separated continuation words after the first name, same
    // as the plain space-separated branch below it.
    // Separator is a colon OR 2+ run of whitespace (`\s{2,}`), not a
    // required colon: table-style layouts ("Patient" | "Donnelly,
    // Katherine R.") have no colon at all, just cell-gap whitespace —
    // extracted as several consecutive spaces, unlike the single space in
    // ordinary prose ("Patient Jane Doe was examined"). Requiring 2+
    // spaces when there's no colon catches the table case while still
    // rejecting normal sentences starting with "Patient ".
    // Label alternatives cover "Patient"/"Patient Name"/"Patient's Name"/
    // "Patient's Full Name"/"Pt Name" — bare "Pt"/"Pt." is deliberately
    // NOT included: it's a near-universal medical-note abbreviation used
    // constantly outside of a name-label context ("55 y/o pt presents..."),
    // so it would false-positive far more than it would ever help.
    label: "PATIENT_NAME",
    pattern:
      /(?:\bPatient(?:'?s)?(?:\s*(?:Full\s+)?Name)?\b|\bPt\s*Name\b)(?:\s*:\s*|\s{2,})([A-Z][a-zA-Z'-]*\.?(?:\s*,\s*[A-Z][a-zA-Z'-]*\.?(?:(?:[ \t]{1,2}|\n(?![ \t]*\n))[A-Z][a-zA-Z'-]*\b(?!\s*[:/])\.?){0,2}|(?:(?:[ \t]{1,2}|\n(?![ \t]*\n))[A-Z][a-zA-Z'-]*\b(?!\s*[:/])\.?){1,2}))/g,
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
    // "(Referring|Ordering|Attending|Consulting|Treating|Interpreting|
    // Supervising) (Physician|Provider)" covers both title conventions at
    // once, e.g. real reports using "Referring Provider" alongside
    // "Consulting Physician" for the equivalent field on different forms.
    // See the PATIENT_NAME comment above for the continuation-word guards.
    pattern:
      /(?:\bReferring\s*\/?\s*Family\s*MD\b|\b(?:Referring|Ordering|Attending|Consulting|Treating|Interpreting|Supervising)\s+(?:Physician|Provider)\b|\bPrimary\s+Care\s+Physician\b|\bReading\s+Radiologist\b|\bRadiologist\b|\bPathologist\b|\bElectronically\s+[Ss]igned(?:\s+[Bb]y)?\b|\bSigned\s+by\b|\bcc\b|\bNurse\b)\s*:?\s*(?:Dr\.?\s+)?([A-Z][a-zA-Z'-]*\.?(?:(?:[ \t]{1,2}|\n(?![ \t]*\n))[A-Z][a-zA-Z'-]*\b(?!\s*[:/])\.?){1,2})/g,
    baseScore: 0.85,
  },
];
