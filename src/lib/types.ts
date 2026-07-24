// Shared schema for both client-side and (future) server-side detection.
// Every layer of the pipeline — regex, NER, review-screen edits — produces
// or consumes this same Entity shape so the two modes stay interchangeable.

export type EntitySource =
  | "regex"
  | "ner-gliner"
  | "ner-piiranha"
  | "ner-distilbert"
  | "manual";

/** A rectangle in unscaled PDF user-space points (origin bottom-left), used for visual redaction. */
export interface PdfRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Entity {
  id: string;
  /** Character offset into the page's extracted text (start inclusive, end exclusive). */
  start: number;
  end: number;
  text: string;
  /** e.g. SSN, PHONE_NUMBER, EMAIL, PATIENT_NAME, DOCTOR_NAME, HOSPITAL, DATE_OF_BIRTH ... */
  label: string;
  score: number;
  source: EntitySource;
  page: number;
  /** Whether this entity is currently included in redaction output. Toggled in the review screen. */
  accepted: boolean;
  rects: PdfRect[];
}

/** A single word/text-run positioned on a page, used to map char offsets back to draw-able rects. */
export interface PositionedRun {
  text: string;
  /** Offset range this run occupies in the page's plain-text string. */
  start: number;
  end: number;
  rect: PdfRect;
}

export interface ExtractedPage {
  page: number;
  text: string;
  isOcr: boolean;
  runs: PositionedRun[];
  widthPts: number;
  heightPts: number;
}

export interface ExtractedDocument {
  pages: ExtractedPage[];
  sourceFileName: string;
}

export interface RedactionProvider {
  mode: "client" | "server";
  /** Detect PII entities in a single page's plain text. Positions are char offsets into `text`. */
  detect(text: string, page: number): Promise<Entity[]>;
}

export interface PipelineProgress {
  stage:
    | "loading-pdf"
    | "extracting-text"
    | "ocr"
    | "loading-model"
    | "detecting"
    | "done";
  page?: number;
  totalPages?: number;
  detail?: string;
}
