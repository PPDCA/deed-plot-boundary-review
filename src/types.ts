export type Severity = "high" | "medium" | "info";

export interface Flag {
  tract: string;
  severity: Severity;
  message: string;
}

export interface CallRow {
  n: number;
  type: string;
  label: string;
  length_ft: number;
  certain: boolean;
  note: string | null;
}

export interface TractSummary {
  name: string;
  role: string;
  kind: string;
  /** The colour the exhibit actually drew this tract in. */
  color: string;
  /** The call sheet's own override, or null if the role colour was used. */
  custom_color: string | null;
  closure_text: string;
  closure_ratio: number | null;
  misclosure_ft: number;
  perimeter_ft: number;
  computed_acres: number;
  recited_acres: number | null;
  delta_pct: number | null;
  indeterminate_calls: { n: number; note: string | null }[];
  calls: CallRow[];
}

export interface PlotResult {
  id: string;
  verdict: string;
  tracts: TractSummary[];
  flags_by_severity: Record<Severity, Flag[]>;
  svg: string;
  callsheet: unknown;
  pdf_url: string;
}

export interface Sample {
  id: string;
  title: string;
  description: string;
  source_document: string | null;
  callsheet: unknown;
}

/* ---- Flow 2: extraction + review ---- */

export interface EditableCall {
  type?: string;
  bearing?: string;
  azimuth?: string;
  distance?: number | null;
  unit?: string;
  monument?: string;
  note?: string;
  radius?: number | null;
  chord_bearing?: string;
  tangent_bearing?: string;
  arc_length?: number | null;
  chord_length?: number | null;
  delta?: string | number | null;
  reverse?: boolean;
  /** review metadata added by the extraction step; ignored by the engine */
  confidence?: "high" | "medium" | "low";
  source_text?: string;
  /** set locally once a human touches the row */
  edited?: boolean;
  was_type?: string;
  [key: string]: unknown;
}

export interface Tract {
  name?: string;
  role?: string;
  /** Optional per-tract colour override, e.g. "#2a6f4d". Drawing only —
      absent means the tract is drawn in its role's colour. */
  color?: string;
  type?: string;
  plss?: Record<string, unknown>;
  recited_area?: { value: number; unit?: string };
  start?: Record<string, unknown>;
  calls?: EditableCall[];
  [key: string]: unknown;
}

export interface CallSheet {
  project?: Record<string, unknown>;
  units_default?: string;
  tracts: Tract[];
  [key: string]: unknown;
}

/* ---- OCR ---- */

export type Confidence = "high" | "medium" | "low";
/** `pasted_text` is the combine flow's paste path — no reading step to assess. */
export type ExtractionMethod = "text_extraction" | "ocr" | "pasted_text";

export interface ExtractionMeta {
  page_count?: number;
  text_layer_chars?: number;
  ocr_mean_confidence?: number;
  ocr_page_confidences?: number[];
  ocr_words?: number;
  ocr_pages_read?: number;
  ocr_pages_total?: number;
  ocr_dpi?: number;
  ocr_truncated?: boolean;
}

export interface OcrStatus {
  available: boolean;
  tesseract_path: string | null;
  tesseract_version: string | null;
  rasteriser: string | null;
  dpi: number;
  max_pages: number;
  install_hint: string | null;
}

export interface Capabilities {
  ocr: OcrStatus;
}

export interface ExtractResult {
  extraction_id: string;
  raw_text: string;
  call_sheet: CallSheet;
  confidence: Confidence;
  extraction_method: ExtractionMethod;
  note: string;
  filename: string | null;
  page_count: number;
  text_confidence: Confidence;
  transcription_confidence: Confidence;
  extraction_meta: ExtractionMeta;
  description_offset: number | null;
  looks_like_metes_and_bounds: boolean;
  low_confidence_calls: { tract: string | null; n: number; note: string | null }[];
  validation: string[];
}

/* ---- combining several documents into one exhibit ---- */

/** How one tract of an added document sits in the combined coordinate system. */
export type Placement = "keep" | "fresh" | "anchor";

/** A vertex of a tract already in the combined plot. */
export interface AnchorSpec {
  /** Position of the target document in the combined list. */
  from_document?: number;
  /** Position of the target tract within that document's call sheet. */
  from_tract_index?: number;
  /** Alternative addressing: the target tract's final name. */
  from_tract?: string;
  /** 0 is the target tract's point of beginning. */
  at_vertex: number;
}

export interface CombineTractSpec {
  index: number;
  name?: string;
  placement: Placement;
  anchor?: AnchorSpec | null;
}

/** Where a document in the combine workspace came from. `callsheet` is a saved
    call sheet loaded back from a JSON file — already structured, so it skips
    transcription entirely. */
export type DocumentSource = "paste" | "upload" | "callsheet";

export interface CombineDocumentSpec {
  label?: string;
  source?: DocumentSource;
  call_sheet: CallSheet;
  tracts: CombineTractSpec[];
}

export interface CombineRequest {
  documents: CombineDocumentSpec[];
  title?: string;
  units_default?: string;
}

/** One vertex of a tract, described well enough to match a deed's words.

    A description says "beginning at the northeast corner of the Doe tract";
    the call sheet wants a vertex number. `corner` and `bearing_from_pob` are
    what let a reviewer line the two up. */
export interface TractVertex {
  n: number;
  /** Compass position within its own figure: "NE", "SW", … "" if degenerate. */
  corner: string;
  distance_from_pob: number;
  bearing_from_pob: string | null;
  /** 1-based call that ends here; null for the POB. Ties add no vertex. */
  after_call: number | null;
  /** The closing vertex of a figure that returns to its POB. */
  closes_on_pob: boolean;
}

export interface TractVertexTable {
  document: number;
  document_label: string;
  tract_index: number;
  name: string;
  vertices: TractVertex[];
}

/** What the merge did, reported alongside the plot. */
export interface CombineReport {
  document_labels: string[];
  tract_names: string[][];
  renamed: {
    document: number;
    document_label: string;
    from: string;
    to: string;
  }[];
  anchors: {
    tract: string;
    document: number;
    from_tract: string;
    at_vertex: number;
    as_described?: boolean;
  }[];
  units_default: string;
  tract_count: number;
}

/** /api/combine-and-plot: /api/plot's shape plus the merge report. */
export interface CombinedPlotResult extends PlotResult {
  combined: CombineReport;
}

export type FeedbackStatus = "open" | "incorporated";
export type VerificationVote = "working" | "not_working";

/** One tester's re-test result against an incorporated submission. */
export interface Verification {
  name: string;
  vote: VerificationVote;
  created_at: string;
}

/** One stored attachment, with the name the tester uploaded it under. */
export interface FeedbackAttachment {
  stored_filename: string;
  original_filename: string;
}

/** A downloadable link to one attachment. */
export interface AttachmentLink {
  url: string;
  filename: string;
}

/** One tester's feedback submission, as returned by /api/feedback. */
export interface FeedbackRecord {
  id: string;
  name: string;
  message: string;
  attachments: FeedbackAttachment[];
  attachment_urls: AttachmentLink[];
  /** @deprecated Mirrors the first attachment; kept for older records. */
  attachment_filename: string | null;
  /** @deprecated Points at the first attachment. Use `attachment_urls`. */
  attachment_url: string | null;
  created_at: string;
  status: FeedbackStatus;
  verifications: Verification[];
  verification_summary: { working: number; not_working: number; total: number };
}
