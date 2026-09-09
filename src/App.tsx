import { useEffect, useState } from "react";
import { fetchSamples, plotCallsheet, plotLegalText } from "./api";
import CombineFlow, { type CombineSeed } from "./CombineFlow";
import FeedbackList from "./FeedbackList";
import FeedbackWidget from "./FeedbackWidget";
import Results from "./Results";
import UploadFlow from "./UploadFlow";
import type { CallSheet, PlotResult, Sample } from "./types";

type View = "home" | "paste" | "upload" | "combine" | "feedback";

const EXTRACT_STEPS = [
  "Reading the description",
  "Transcribing courses",
  "Verifying the transcription",
  "Plotting the boundary",
  "Checking geometry",
];

export default function App() {
  const [view, setView] = useState<View>("home");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [samplesError, setSamplesError] = useState<string | null>(null);

  const [legalText, setLegalText] = useState("");
  const [busy, setBusy] = useState<null | { label: string; steps: boolean }>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlotResult | null>(null);
  // Bumped after a submission so an open All-feedback list re-fetches.
  const [feedbackKey, setFeedbackKey] = useState(0);
  // A document handed from Flow 1 or Flow 2 into the combine workspace.
  const [seed, setSeed] = useState<CombineSeed | null>(null);

  useEffect(() => {
    fetchSamples()
      .then(setSamples)
      .catch((e: Error) => setSamplesError(e.message));
  }, []);

  // Advance the step list while the LLM call is in flight. The backend is a
  // single request, so these are indicative of the pipeline, not per-step
  // progress events -- the final step holds until the response lands.
  useEffect(() => {
    if (!busy?.steps) return;
    setStep(0);
    const timer = setInterval(
      () => setStep((s) => Math.min(s + 1, EXTRACT_STEPS.length - 1)),
      2600,
    );
    return () => clearInterval(timer);
  }, [busy]);

  async function runPaste() {
    setError(null);
    setResult(null);
    setBusy({ label: "Reading the description and plotting", steps: true });
    try {
      setResult(await plotLegalText(legalText));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runSample(s: Sample) {
    setError(null);
    setResult(null);
    setView("paste");
    setLegalText("");
    setBusy({ label: `Plotting “${s.title}”`, steps: false });
    try {
      setResult(await plotCallsheet(s.callsheet));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Carry the document on screen into the combine workspace, rather than
      making the reviewer transcribe it a second time. */
  function handOff(next: CombineSeed) {
    setSeed(next);
    setView("combine");
  }

  function goHome() {
    setView("home");
    setResult(null);
    setError(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          Deed Plot <small>boundary review</small>
        </span>
        <nav>
          <button onClick={goHome} aria-current={view === "home" ? "page" : undefined}>
            Start
          </button>
          <button
            onClick={() => setView("paste")}
            aria-current={view === "paste" ? "page" : undefined}
          >
            Paste description
          </button>
          <button
            onClick={() => setView("upload")}
            aria-current={view === "upload" ? "page" : undefined}
          >
            Upload deed
          </button>
          <button
            onClick={() => setView("combine")}
            aria-current={view === "combine" ? "page" : undefined}
          >
            Combine documents
          </button>
          <button
            onClick={() => setView("feedback")}
            aria-current={view === "feedback" ? "page" : undefined}
          >
            All feedback
          </button>
        </nav>
        <span className="spacer" />
        <span className="disclaimer">
          A plot of the description. Not a survey, and it does not clear a title exception.
        </span>
      </header>

      <main>
        {view === "upload" ? (
          <UploadFlow
            onAddAnother={(label, sheet, extraction) =>
              handOff({ label, source: "upload", sheet, extraction })
            }
          />
        ) : view === "combine" ? (
          <CombineFlow seed={seed} onSeedConsumed={() => setSeed(null)} />
        ) : view === "feedback" ? (
          <FeedbackList reloadKey={feedbackKey} />
        ) : view === "home" ? (
          <div className="wrap">
            <h1>Plot a legal description and check its geometry</h1>
            <p className="lede">
              Turn the courses recited in a deed into a boundary, then check what the geometry
              says: whether the description closes, how the computed acreage compares with the
              acreage recited, and whether anything in it cannot be plotted from the words.
            </p>

            <p className="section-label">Choose an entry point</p>
            <div className="entry-grid">
              <button className="entry-card" onClick={() => setView("paste")}>
                <span className="num">FLOW 1</span>
                <strong>Paste legal description</strong>
                <span>
                  Paste the metes-and-bounds text from a deed. The courses are transcribed, then
                  plotted and checked.
                </span>
              </button>
              <button className="entry-card" onClick={() => setView("upload")}>
                <span className="num">FLOW 2</span>
                <strong>Upload deed document</strong>
                <span>
                  Upload a deed PDF, review the extracted description, correct anything misread,
                  then plot.
                </span>
              </button>
              <button
                className="entry-card"
                onClick={() => {
                  setSeed(null);
                  setView("combine");
                }}
              >
                <span className="num">FLOW 3</span>
                <strong>Combine two or more documents</strong>
                <span>
                  Transcribe each instrument on its own, say where each new tract attaches to
                  one already plotted, then plot them as a single exhibit.
                </span>
              </button>
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>Reference call sheets</h2>
                <span className="spacer" />
                <span className="section-label" style={{ margin: 0 }}>
                  already structured — plotted directly, no transcription step
                </span>
              </div>
              <div className="panel-body">
                {samplesError ? (
                  <div className="error-box">
                    <strong>Could not load the reference call sheets</strong>
                    <p>{samplesError}</p>
                  </div>
                ) : samples.length === 0 ? (
                  <p className="no-findings">Loading…</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="sample-table">
                      <thead>
                        <tr>
                          <th>Call sheet</th>
                          <th>What it exercises</th>
                          <th>Source</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {samples.map((s) => (
                          <tr key={s.id}>
                            <td>{s.title}</td>
                            <td className="desc">{s.description}</td>
                            <td className="src">{s.source_document ?? "—"}</td>
                            <td style={{ textAlign: "right" }}>
                              <button
                                className="btn-secondary sample-row"
                                onClick={() => runSample(s)}
                                disabled={busy !== null}
                              >
                                Plot
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="wrap">
            <h1>Paste a legal description</h1>
            <p className="lede">
              Paste the description exactly as recited. Courses that cannot be expressed as a
              bearing and distance — a creek meander, “along the old Smith line”, an illegible
              line — are marked indeterminate rather than guessed at.
            </p>

            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-body">
                <textarea
                  className="legal"
                  value={legalText}
                  onChange={(e) => setLegalText(e.target.value)}
                  placeholder={
                    "BEGINNING at an iron pin on the northern margin of Old Mill Road;\n" +
                    "thence North 05 degrees 15 minutes East 620.00 feet to an iron pin;\n" +
                    "thence North 84 degrees 30 minutes East 590.00 feet;\n" +
                    "thence South 06 degrees 00 minutes West 640.00 feet;\n" +
                    "thence with the meanders of Little Creek westwardly to the POINT OF " +
                    "BEGINNING, containing 8.5 acres, more or less."
                  }
                  spellCheck={false}
                  disabled={busy !== null}
                />
                <div className="field-row" style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={runPaste}
                    disabled={busy !== null || legalText.trim().length === 0}
                  >
                    {busy ? "Plotting…" : "Plot description"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setLegalText("");
                      setResult(null);
                      setError(null);
                    }}
                    disabled={busy !== null}
                  >
                    Clear
                  </button>
                  <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                    Transcription takes around 20–40 seconds.
                  </span>
                </div>
              </div>
            </div>

            {busy && (
              <div className="status">
                <span className="spinner" />
                <div>
                  <div>{busy.label}…</div>
                  {busy.steps && (
                    <ul className="steps">
                      {EXTRACT_STEPS.map((s, i) => (
                        <li
                          key={s}
                          className={i < step ? "done" : i === step ? "active" : ""}
                        >
                          {i < step ? "✓ " : i === step ? "› " : "  "}
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="error-box">
                <strong>Could not plot this description</strong>
                <p>{error}</p>
              </div>
            )}

            {result && (
              <>
                <div className="handoff">
                  <div>
                    <strong>Another instrument to plot with this one?</strong>
                    <p>
                      An easement, a less-and-except parcel or a parent tract recited in a
                      separate document is transcribed on its own, and you choose which
                      corner of this tract it begins at.
                    </p>
                  </div>
                  <span className="spacer" />
                  <button
                    className="btn-secondary"
                    onClick={() =>
                      handOff({
                        // the project title is a description of the tract, not
                        // a name for the document -- only a recited source
                        // document reads as one
                        label:
                          String(
                            ((result.callsheet as CallSheet)?.project
                              ?.source_document as string) ?? "",
                          ) || "Pasted description",
                        source: "paste",
                        sheet: result.callsheet as CallSheet,
                      })
                    }
                  >
                    Add another document
                  </button>
                </div>
                <Results result={result} />
              </>
            )}
          </div>
        )}
      </main>

      <FeedbackWidget
        onSubmitted={() => setFeedbackKey((k) => k + 1)}
        onViewAll={() => setView("feedback")}
      />
    </div>
  );
}
