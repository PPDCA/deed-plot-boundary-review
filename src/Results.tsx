import { Fragment, useMemo, useState } from "react";
import type { PlotResult, Severity, TractSummary } from "./types";

const EMPTY: Set<number> = new Set();

const GROUPS: { key: Severity; heading: string }[] = [
  { key: "high", heading: "Must resolve" },
  { key: "medium", heading: "Should check" },
  { key: "info", heading: "Noted" },
];

function verdictClass(counts: Record<Severity, number>) {
  if (counts.high > 0) return "v-high";
  if (counts.medium > 0) return "v-medium";
  return "v-clean";
}

function closureCell(t: TractSummary) {
  // closure_text comes from the engine's own closure_text(); the ratio is shown
  // alongside only when the engine actually computed one.
  if (t.closure_ratio && t.closure_text.startsWith("1:")) {
    return `${t.closure_text} (${t.misclosure_ft.toFixed(3)}′)`;
  }
  if (t.closure_text === "exact") return `exact (${t.misclosure_ft.toFixed(3)}′)`;
  return t.closure_text;
}

function deltaClass(pct: number) {
  const a = Math.abs(pct);
  if (a <= 2) return "delta-ok";
  if (a <= 10) return "delta-warn";
  return "delta-bad";
}

/** Save the call sheet behind a plot as a JSON file.

    The whole of "come back next week and add an easement to this" rests on
    this: the sheet is the plot's source of truth, so a copy of it on disk is a
    plot you can reopen. It loads straight back into the combine flow with no
    transcription step, since it is already structured. */
function downloadCallSheet(result: PlotResult) {
  const sheet = result.callsheet as { project?: Record<string, unknown> } | null;
  const project = sheet?.project ?? {};
  const stem =
    String(project.file_number ?? project.title ?? "deed_plot")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "deed_plot";

  const blob = new Blob([JSON.stringify(result.callsheet, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}_callsheet.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Results({ result }: { result: PlotResult }) {
  const f = result.flags_by_severity;

  /* Which tracts are drawn. The engine tags every artist it draws with
     id="tract<i>-<part>", so hiding one is a CSS rule against that prefix --
     no re-plot, no request, and the exhibit that was rendered is the exhibit
     being filtered.

     Keyed by plot id rather than reset in an effect: a new plot then starts
     with everything visible on its first render, with no intermediate frame
     showing the previous plot's filter. */
  const [state, setState] = useState<{ id: string; hidden: Set<number> }>({
    id: result.id,
    hidden: new Set(),
  });
  const hidden = state.id === result.id ? state.hidden : EMPTY;

  function setHidden(next: Set<number>) {
    setState({ id: result.id, hidden: next });
  }

  const hideCss = useMemo(
    () =>
      [...hidden]
        .map((i) => `.plot-frame [id^="tract${i}-"]{display:none}`)
        .join("\n"),
    [hidden],
  );

  function toggle(i: number) {
    const next = new Set(hidden);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setHidden(next);
  }
  const counts: Record<Severity, number> = {
    high: f.high?.length ?? 0,
    medium: f.medium?.length ?? 0,
    info: f.info?.length ?? 0,
  };

  // Any indeterminate call makes closure and acreage indicative only. The
  // engine flags this; the caveat is repeated next to the numbers themselves so
  // they are never read as clean.
  const unreliable = result.tracts.filter((t) => t.indeterminate_calls.length > 0);

  return (
    <div>
      <div className={`verdict-bar ${verdictClass(counts)}`}>
        <span className="verdict-text">{result.verdict}</span>
        <div className="counts">
          {counts.high > 0 && <span className="chip chip-high">{counts.high} must resolve</span>}
          {counts.medium > 0 && (
            <span className="chip chip-medium">{counts.medium} should check</span>
          )}
          {counts.info > 0 && <span className="chip chip-info">{counts.info} noted</span>}
          {counts.high + counts.medium + counts.info === 0 && (
            <span className="chip chip-info">no findings</span>
          )}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="btn-secondary"
          onClick={() => downloadCallSheet(result)}
          title="Save the structured call sheet behind this plot, to reopen and build on later"
        >
          Download call sheet
        </button>
        <a className="btn" href={result.pdf_url} download>
          Download PDF exhibit
        </a>
      </div>

      <div className="results-grid">
        <div className="panel">
          <div className="panel-head">
            <h2>Plot</h2>
            <span className="spacer" />
            <span className="section-label" style={{ margin: 0 }}>
              plot of the description — not a survey
            </span>
          </div>
          <div className="panel-body">
            {/* Doubles as the legend: each swatch is the colour the exhibit
                actually drew that tract in, custom or role default. */}
            <div className="tract-toggles">
              <span className="section-label" style={{ margin: 0 }}>
                shown on the plot
              </span>
              {result.tracts.map((t, i) => (
                <label
                  key={t.name}
                  className={hidden.has(i) ? "off" : undefined}
                  title={
                    t.custom_color
                      ? `${t.role} — custom colour ${t.color}`
                      : `${t.role} — role colour ${t.color}`
                  }
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <span className="swatch" style={{ background: t.color }} />
                  <span className="tt-name">{t.name}</span>
                </label>
              ))}
              {hidden.size > 0 && (
                <button className="btn-secondary" onClick={() => setHidden(new Set())}>
                  Show all
                </button>
              )}
            </div>
            {hideCss && <style>{hideCss}</style>}
            {/* SVG is generated server-side by the engine's make_svg() */}
            <div className="plot-frame" dangerouslySetInnerHTML={{ __html: result.svg }} />
            {hidden.size > 0 && (
              <p className="caveat" style={{ marginBottom: 0 }}>
                {hidden.size} tract{hidden.size === 1 ? " is" : "s are"} hidden from
                the drawing above. The geometry table, findings and call table below,
                and the downloadable PDF exhibit, all still cover every tract — hiding
                a tract is a way to read a busy plot, never a way to drop a finding.
              </p>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div className="panel">
            <div className="panel-head">
              <h2>Geometry</h2>
            </div>
            <div className="panel-body">
              <div style={{ overflowX: "auto" }}>
                <table className="metrics">
                  <thead>
                    <tr>
                      <th>Tract</th>
                      <th>Closure</th>
                      <th>Computed</th>
                      <th>Recited</th>
                      <th>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.tracts.map((t, i) => (
                      <tr key={t.name} className={hidden.has(i) ? "row-hidden" : ""}>
                        <td className="tname">
                          <span
                            className="swatch"
                            style={{ background: t.color }}
                            aria-hidden="true"
                          />
                          {t.name}
                          <span className="role">
                            {t.role}
                            {hidden.has(i) ? " · hidden from the drawing" : ""}
                          </span>
                        </td>
                        <td className="num">{closureCell(t)}</td>
                        <td className="num">{t.computed_acres.toFixed(3)} ac</td>
                        <td className="num">
                          {t.recited_acres === null ? "—" : `${t.recited_acres.toFixed(3)} ac`}
                        </td>
                        <td className={`num ${t.delta_pct === null ? "" : deltaClass(t.delta_pct)}`}>
                          {t.delta_pct === null
                            ? "—"
                            : `${t.delta_pct >= 0 ? "+" : ""}${t.delta_pct.toFixed(2)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {unreliable.length > 0 && (
                <p className="caveat">
                  {unreliable.length === 1
                    ? `${unreliable[0].name} contains a call that cannot be plotted from the description.`
                    : `${unreliable.length} tracts contain calls that cannot be plotted from the description.`}{" "}
                  The closure and acreage figures above are <strong>indicative only</strong> until
                  those calls are resolved from a plat, the record, or a survey.
                </p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Findings</h2>
            </div>
            <div className="panel-body">
              {counts.high + counts.medium + counts.info === 0 ? (
                <p className="no-findings">No geometric exceptions were raised.</p>
              ) : (
                GROUPS.map(({ key, heading }) => {
                  const items = f[key] ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div className={`findings-group g-${key}`} key={key}>
                      <h3>
                        {heading} ({items.length})
                      </h3>
                      {items.map((flag, i) => (
                        <div className="finding" key={`${key}-${i}`}>
                          <span className="bar" />
                          <div>
                            <span className="tract">{flag.tract}</span>
                            <p>{flag.message}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h2>Call table</h2>
          <span className="spacer" />
          <span className="section-label" style={{ margin: 0 }}>
            as transcribed
          </span>
        </div>
        <div className="panel-body">
          <div style={{ overflowX: "auto" }}>
            <table className="calls">
              <thead>
                <tr>
                  <th className="n">#</th>
                  <th>Course</th>
                  <th style={{ textAlign: "right" }}>Length</th>
                </tr>
              </thead>
              <tbody>
                {result.tracts.map((t) => (
                  <Fragment key={t.name}>
                    {result.tracts.length > 1 && (
                      <tr key={`${t.name}-head`}>
                        <td colSpan={3} className="calls-tract-head">
                          {t.name}
                        </td>
                      </tr>
                    )}
                    {t.calls.length === 0 && (
                      <tr key={`${t.name}-none`}>
                        <td colSpan={3} style={{ color: "var(--ink-soft)" }}>
                          Nominal aliquot geometry — no individual courses.
                        </td>
                      </tr>
                    )}
                    {t.calls.map((c) => (
                      <tr key={`${t.name}-${c.n}`} className={c.certain ? "" : "uncertain"}>
                        <td className="n">{c.n}</td>
                        <td className="label">{c.label}</td>
                        <td className="len">{c.length_ft.toFixed(2)}′</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
