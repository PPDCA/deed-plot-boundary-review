import { useEffect, useMemo, useRef, useState } from "react";
import { extractDeed, fetchCapabilities, validateAndPlot } from "./api";
import CallEditor from "./CallEditor";
import Results from "./Results";
import type {
  CallSheet,
  Confidence,
  ExtractResult,
  OcrStatus,
  PlotResult,
} from "./types";

const EXTRACT_STEPS = [
  "Reading the document",
  "Locating the legal description",
  "Transcribing courses",
  "Verifying the transcription",
];

/* The method is only known once the response lands, so the progress panel
   starts generic and, if the request is still running after this long, adds the
   OCR notice -- a text-layer read returns well inside it. */
const OCR_LIKELY_AFTER_MS = 7000;

function countCalls(sheet: CallSheet | null) {
  if (!sheet) return 0;
  return (sheet.tracts ?? []).reduce((n, t) => n + (t.calls?.length ?? 0), 0);
}

function chipClassFor(c: Confidence) {
  return c === "low" ? "chip-high" : c === "medium" ? "chip-medium" : "chip-info";
}

/** The banner the spec asks for: extraction quality, stated plainly. */
function ConfidenceBanner({ x }: { x: ExtractResult }) {
  const ocr = x.extraction_method === "ocr";
  const mean = x.extraction_meta?.ocr_mean_confidence;

  if (x.confidence === "low") {
    return (
      <div className="banner banner-low">
        <span className="banner-mark" aria-hidden="true">!</span>
        <div>
          <strong>Low-confidence extraction — check every call against the page.</strong>
          <p>
            {ocr
              ? `This document had no text layer, so it was read by optical character
                 recognition${mean != null ? ` at a mean character confidence of ${mean}%` : ""}.
                 On a poor scan, digits in a distance and minutes in a bearing are the
                 first things to be misread, and a wrong digit still plots a
                 convincing-looking figure.`
              : `The transcription step reported low confidence in the courses it
                 produced. Read each one against the document before plotting.`}
          </p>
        </div>
      </div>
    );
  }

  if (x.confidence === "medium") {
    return (
      <div className="banner banner-medium">
        <span className="banner-mark" aria-hidden="true">i</span>
        <div>
          <strong>
            {ocr
              ? "Read by OCR — review the calls before plotting."
              : "Review the calls before plotting."}
          </strong>
          <p>
            {ocr
              ? `No text layer was present, so the pages were rasterised at
                 ${x.extraction_meta?.ocr_dpi ?? 300} DPI and read by Tesseract${
                   mean != null ? ` (mean character confidence ${mean}%)` : ""
                 }. OCR output is usually right and occasionally wrong in ways that
                 look right.`
              : `The text came from the PDF's own text layer, but the transcription
                 step was not fully confident about every course.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="banner banner-high">
      <span className="banner-mark" aria-hidden="true">✓</span>
      <div>
        <strong>Text read directly from the PDF.</strong>
        <p>
          This document has its own text layer, so no character recognition was
          needed and the wording is exact. The transcription into courses is still
          worth a check.
        </p>
      </div>
    </div>
  );
}

interface Props {
  /** Hand this document to the combine workspace instead of plotting it alone.
      Absent means the single-document flow, exactly as before. */
  onAddAnother?: (
    label: string,
    sheet: CallSheet,
    extraction: ExtractResult,
  ) => void;
}

export default function UploadFlow({ onAddAnother }: Props = {}) {
  const fileInput = useRef<HTMLInputElement>(null);

  const [ocr, setOcr] = useState<OcrStatus | null>(null);

  const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [step, setStep] = useState(0);
  const [slow, setSlow] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [extraction, setExtraction] = useState<ExtractResult | null>(null);
  const [sheet, setSheet] = useState<CallSheet | null>(null);

  const [plotting, setPlotting] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [result, setResult] = useState<PlotResult | null>(null);

  useEffect(() => {
    fetchCapabilities()
      .then((c) => setOcr(c.ocr))
      .catch(() => setOcr(null));
  }, []);

  const edited = useMemo(
    () =>
      (sheet?.tracts ?? []).some((t) => (t.calls ?? []).some((c) => c.edited)),
    [sheet],
  );

  async function handleFile(file: File) {
    setExtractError(null);
    setPlotError(null);
    setExtraction(null);
    setSheet(null);
    setResult(null);

    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setExtractError(
        `“${file.name}” is not a PDF. This flow reads PDF deeds — text-based or scanned.`,
      );
      return;
    }

    setExtracting(true);
    setStep(0);
    setSlow(false);
    const ticker = setInterval(
      () => setStep((s) => Math.min(s + 1, EXTRACT_STEPS.length - 1)),
      3000,
    );
    const slowTimer = setTimeout(() => setSlow(true), OCR_LIKELY_AFTER_MS);
    try {
      const res = await extractDeed(file);
      setExtraction(res);
      setSheet(res.call_sheet);
    } catch (e) {
      setExtractError((e as Error).message);
    } finally {
      clearInterval(ticker);
      clearTimeout(slowTimer);
      setExtracting(false);
      setSlow(false);
    }
  }

  async function plot() {
    if (!sheet) return;
    setPlotError(null);
    setResult(null);
    setPlotting(true);
    try {
      setResult(await validateAndPlot(sheet));
    } catch (e) {
      setPlotError((e as Error).message);
    } finally {
      setPlotting(false);
    }
  }

  function reset() {
    setExtraction(null);
    setSheet(null);
    setResult(null);
    setExtractError(null);
    setPlotError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  const busy = extracting || plotting;
  const isOcr = extraction?.extraction_method === "ocr";
  const meta = extraction?.extraction_meta;

  return (
    <div className="wrap">
      <h1>Upload a deed document</h1>
      <p className="lede">
        A text-based PDF is read directly. A scan or photograph has no text layer, so its
        pages are read by optical character recognition instead. Either way the
        description is transcribed into courses for you to check against the page before
        anything is plotted.
      </p>

      {!extraction && (
        <>
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${
              extracting ? "disabled" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!extracting) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (extracting) return;
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              disabled={extracting}
              id="deed-file"
              className="visually-hidden"
            />
            <p className="dz-main">Drop a deed PDF here</p>
            <p className="dz-sub">
              or{" "}
              <label htmlFor="deed-file" className="link-label">
                choose a file
              </label>
              . Text-based or scanned.
            </p>
            {ocr && (
              <p className="dz-cap">
                {ocr.available ? (
                  <>
                    Scanned documents supported — OCR via Tesseract{" "}
                    {ocr.tesseract_version} at {ocr.dpi} DPI, up to {ocr.max_pages} pages.
                  </>
                ) : (
                  <>Scanned documents are not supported on this machine — see below.</>
                )}
              </p>
            )}
          </div>

          {ocr && !ocr.available && (
            <div className="banner banner-medium">
              <span className="banner-mark" aria-hidden="true">i</span>
              <div>
                <strong>OCR is unavailable, so scanned deeds cannot be read.</strong>
                <p>
                  Text-based PDFs still work. {ocr.install_hint}
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {extracting && (
        <div className="status">
          <span className="spinner" />
          <div>
            <div>
              {slow
                ? "No text layer found — running OCR. This can take 10–30 seconds per page…"
                : "Reading the document and transcribing the description…"}
            </div>
            <ul className="steps">
              {EXTRACT_STEPS.map((s, i) => (
                <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
                  {i < step ? "✓ " : i === step ? "› " : "  "}
                  {i === 0 && slow ? "Reading the document by OCR" : s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {extractError && (
        <div className="error-box">
          <strong>Could not extract a description from that document</strong>
          <p>{extractError}</p>
        </div>
      )}

      {extraction && sheet && (
        <>
          <div className="extract-bar">
            <div>
              <span className="section-label" style={{ margin: 0 }}>
                extracted from
              </span>
              <div className="ex-file">
                {extraction.filename ?? "document.pdf"}{" "}
                <span className="muted">
                  · {extraction.page_count} page
                  {extraction.page_count === 1 ? "" : "s"} ·{" "}
                  {extraction.raw_text.length.toLocaleString()} characters ·{" "}
                  {countCalls(sheet)} calls
                </span>
              </div>
            </div>
            <span className="spacer" />
            <span className={`chip ${isOcr ? "chip-medium" : "chip-info"}`}>
              {isOcr ? "OCR" : "text layer"}
            </span>
            <span className={`chip ${chipClassFor(extraction.confidence)}`}>
              confidence: {extraction.confidence}
            </span>
            <button className="btn-secondary" onClick={reset} disabled={busy}>
              Start over
            </button>
          </div>

          <ConfidenceBanner x={extraction} />

          {isOcr && meta && (
            <div className="ocr-stats">
              <span className="section-label" style={{ margin: 0 }}>
                ocr detail
              </span>
              <dl>
                <div>
                  <dt>Mean character confidence</dt>
                  <dd>{meta.ocr_mean_confidence}%</dd>
                </div>
                <div>
                  <dt>Per page</dt>
                  <dd>
                    {(meta.ocr_page_confidences ?? []).map((c) => `${c}%`).join(", ") ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt>Words recognised</dt>
                  <dd>{meta.ocr_words ?? "—"}</dd>
                </div>
                <div>
                  <dt>Resolution</dt>
                  <dd>{meta.ocr_dpi} DPI</dd>
                </div>
                <div>
                  <dt>Pages read</dt>
                  <dd>
                    {meta.ocr_pages_read} of {meta.ocr_pages_total}
                    {meta.ocr_truncated ? " (truncated)" : ""}
                  </dd>
                </div>
                <div>
                  <dt>Text layer found</dt>
                  <dd>{meta.text_layer_chars ?? 0} characters</dd>
                </div>
              </dl>
            </div>
          )}

          {extraction.note && (
            <div className="caveat" style={{ marginBottom: 16 }}>
              <strong>From the transcription step:</strong> {extraction.note}
            </div>
          )}

          {extraction.validation.length > 0 && (
            <div className="error-box">
              <strong>The extracted call sheet has problems to fix below</strong>
              <ul>
                {extraction.validation.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {!extraction.looks_like_metes_and_bounds && (
            <div className="caveat" style={{ marginBottom: 16 }}>
              This document does not read like a metes-and-bounds description. If it is a
              lot-and-block description, the geometry lives on the recorded plat rather
              than in the words, and there is nothing here to plot.
            </div>
          )}

          <div className="review-grid">
            <div className="panel">
              <div className="panel-head">
                <h2>Document text</h2>
                <span className="spacer" />
                <span className="section-label" style={{ margin: 0 }}>
                  {isOcr ? "as read by OCR — not edited" : "read from the PDF — not edited"}
                </span>
              </div>
              <div className="panel-body">
                <pre className="raw-text">{extraction.raw_text}</pre>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>Extracted calls</h2>
                <span className="spacer" />
                <span className="section-label" style={{ margin: 0 }}>
                  {edited ? "edited — check against the page" : "check against the page"}
                </span>
              </div>
              <div className="panel-body">
                <CallEditor
                  sheet={sheet}
                  onChange={setSheet}
                  disabled={busy}
                  ocrMode={isOcr}
                />

                <div className="field-row" style={{ marginTop: 14 }}>
                  <button className="btn" onClick={plot} disabled={busy}>
                    {plotting ? "Plotting…" : "Validate & plot"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => setSheet(extraction.call_sheet)}
                    disabled={busy || !edited}
                  >
                    Revert to extraction
                  </button>
                  {onAddAnother && (
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        onAddAnother(
                          extraction.filename ?? "Uploaded deed",
                          sheet,
                          extraction,
                        )
                      }
                      disabled={busy}
                      title="Carry these calls into the combine workspace and add a second document"
                    >
                      Add another document
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {plotting && (
            <div className="status" style={{ marginTop: 14 }}>
              <span className="spinner" />
              <div>Plotting the corrected description and checking geometry…</div>
            </div>
          )}

          {plotError && (
            <div className="error-box" style={{ marginTop: 14 }}>
              <strong>Could not plot this call sheet</strong>
              <p>{plotError}</p>
            </div>
          )}

          {result && (
            <div style={{ marginTop: 18 }}>
              <Results result={result} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
