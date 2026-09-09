import TractColorPicker from "./TractColorPicker";
import type { CallSheet, EditableCall, Tract } from "./types";

/* The editable call table. Edits mutate the call sheet in place (via the
   onChange callback), so what gets plotted is literally the schema the engine
   consumes -- no separate edit model to drift out of sync. */

const UNITS = [
  "feet", "chains", "poles", "rods", "links", "varas", "meters", "yards", "miles",
];

interface Props {
  sheet: CallSheet;
  onChange: (next: CallSheet) => void;
  disabled?: boolean;
  /** Text came from OCR, so unedited rows carry recognition risk. */
  ocrMode?: boolean;
}

function clone(sheet: CallSheet): CallSheet {
  return JSON.parse(JSON.stringify(sheet));
}

function confidenceChip(c?: string, ocrMode?: boolean) {
  if (c === "low") return <span className="chip chip-high" title="Low confidence — verify against the document">low</span>;
  if (c === "medium") return <span className="chip chip-medium" title="Medium confidence — worth checking">med</span>;
  if (c === "high") {
    // Even a confidently transcribed course is only as good as the characters
    // OCR recovered, so a text-layer read and an OCR read are marked apart.
    return ocrMode ? (
      <span className="chip chip-medium" title="Transcribed confidently, but the underlying text came from OCR">ocr</span>
    ) : (
      <span className="chip chip-info" title="High confidence">high</span>
    );
  }
  return ocrMode ? (
    <span className="chip chip-medium" title="Read by OCR — verify against the document">ocr</span>
  ) : null;
}

export default function CallEditor({ sheet, onChange, disabled, ocrMode }: Props) {
  const tracts: Tract[] = sheet.tracts ?? [];

  function update(fn: (draft: CallSheet) => void) {
    const draft = clone(sheet);
    fn(draft);
    onChange(draft);
  }

  function setCall(ti: number, ci: number, patch: Partial<EditableCall>) {
    update((d) => {
      const call = d.tracts[ti].calls![ci];
      Object.assign(call, patch);
      // Editing a call by hand means it is no longer the AI's transcription.
      call.edited = true;
      delete call.confidence;
    });
  }

  function toggleUnknown(ti: number, ci: number, makeUnknown: boolean) {
    update((d) => {
      const call = d.tracts[ti].calls![ci];
      if (makeUnknown) {
        call.was_type = call.type ?? "line";
        call.type = "unknown";
        call.note = call.note || "call not determinable from the description";
      } else {
        call.type = (call.was_type as string) || "line";
        delete call.was_type;
      }
      call.edited = true;
      delete call.confidence;
    });
  }

  function move(ti: number, ci: number, delta: number) {
    update((d) => {
      const calls = d.tracts[ti].calls!;
      const to = ci + delta;
      if (to < 0 || to >= calls.length) return;
      [calls[ci], calls[to]] = [calls[to], calls[ci]];
    });
  }

  function remove(ti: number, ci: number) {
    update((d) => {
      d.tracts[ti].calls!.splice(ci, 1);
    });
  }

  function add(ti: number) {
    update((d) => {
      d.tracts[ti].calls = d.tracts[ti].calls ?? [];
      d.tracts[ti].calls!.push({
        type: "line",
        bearing: "",
        distance: null,
        edited: true,
      });
    });
  }

  return (
    <div>
      {tracts.map((tract, ti) => {
        const isAliquot =
          String(tract.type ?? "").toLowerCase() === "aliquot" || !!tract.plss;
        const calls = tract.calls ?? [];

        return (
          <div key={ti} className="tract-block">
            <div className="tract-head">
              <input
                className="in-name"
                value={tract.name ?? ""}
                onChange={(e) =>
                  update((d) => {
                    d.tracts[ti].name = e.target.value;
                  })
                }
                disabled={disabled}
                aria-label="Tract name"
              />
              <select
                className="in-role"
                value={String(tract.role ?? "subject")}
                onChange={(e) =>
                  update((d) => {
                    d.tracts[ti].role = e.target.value;
                  })
                }
                disabled={disabled}
                aria-label="Tract role"
              >
                {["subject", "easement", "exception", "adjoiner", "parent", "other"].map(
                  (r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ),
                )}
              </select>
              <TractColorPicker
                tract={tract}
                disabled={disabled}
                onChange={(color) =>
                  update((d) => {
                    if (color === null) delete d.tracts[ti].color;
                    else d.tracts[ti].color = color;
                  })
                }
                label={`Colour for ${tract.name ?? `tract ${ti + 1}`}`}
              />
              <span className="spacer" />
              <label className="recited">
                recited
                <input
                  className="in-num"
                  type="number"
                  step="0.001"
                  value={tract.recited_area?.value ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    update((d) => {
                      const v = e.target.value;
                      if (v === "") {
                        delete d.tracts[ti].recited_area;
                      } else {
                        d.tracts[ti].recited_area = {
                          value: Number(v),
                          unit: d.tracts[ti].recited_area?.unit ?? "acres",
                        };
                      }
                    })
                  }
                  disabled={disabled}
                />
                ac
              </label>
            </div>

            {isAliquot ? (
              <p className="aliquot-note">
                Nominal PLSS aliquot tract — geometry comes from the aliquot
                description, not from individual courses.
              </p>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table className="editor">
                    <thead>
                      <tr>
                        <th className="c-n">#</th>
                        <th className="c-type">Type</th>
                        <th>Bearing</th>
                        <th className="c-dist">Distance</th>
                        <th className="c-unit">Unit</th>
                        <th>Monument</th>
                        <th className="c-conf">AI</th>
                        <th className="c-act" />
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((call, ci) => {
                        const type = String(call.type ?? "line").toLowerCase();
                        const isUnknown = [
                          "unknown", "indeterminate", "meander", "gap",
                        ].includes(type);
                        const isCurve = type === "curve" || type === "arc";

                        return (
                          <tr
                            key={ci}
                            className={`${isUnknown ? "row-unknown" : ""} ${
                              call.confidence === "low" ? "row-lowconf" : ""
                            }`}
                          >
                            <td className="c-n">{ci + 1}</td>
                            <td className="c-type">
                              <select
                                value={isUnknown ? "unknown" : type}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === "unknown") toggleUnknown(ti, ci, true);
                                  else setCall(ti, ci, { type: v });
                                }}
                                disabled={disabled}
                                aria-label={`Call ${ci + 1} type`}
                              >
                                <option value="line">line</option>
                                <option value="curve">curve</option>
                                <option value="tie">tie</option>
                                <option value="unknown">unknown</option>
                              </select>
                            </td>

                            {isUnknown ? (
                              <td colSpan={4}>
                                <input
                                  className="in-note"
                                  value={call.note ?? ""}
                                  placeholder="what the deed recites for this call"
                                  onChange={(e) =>
                                    setCall(ti, ci, { note: e.target.value })
                                  }
                                  disabled={disabled}
                                  aria-label={`Call ${ci + 1} note`}
                                />
                              </td>
                            ) : (
                              <>
                                <td>
                                  <input
                                    className="in-bearing"
                                    value={
                                      (isCurve
                                        ? call.chord_bearing
                                        : call.bearing) ?? ""
                                    }
                                    placeholder={
                                      isCurve ? "chord bearing" : "N 45-30-20 E"
                                    }
                                    onChange={(e) =>
                                      setCall(
                                        ti,
                                        ci,
                                        isCurve
                                          ? { chord_bearing: e.target.value }
                                          : { bearing: e.target.value },
                                      )
                                    }
                                    disabled={disabled}
                                    aria-label={`Call ${ci + 1} bearing`}
                                  />
                                </td>
                                <td className="c-dist">
                                  <input
                                    className="in-num"
                                    type="number"
                                    step="0.01"
                                    value={
                                      (isCurve
                                        ? (call.radius as number)
                                        : (call.distance as number)) ?? ""
                                    }
                                    placeholder={isCurve ? "radius" : "0.00"}
                                    onChange={(e) => {
                                      const v =
                                        e.target.value === ""
                                          ? null
                                          : Number(e.target.value);
                                      setCall(
                                        ti,
                                        ci,
                                        isCurve ? { radius: v } : { distance: v },
                                      );
                                    }}
                                    disabled={disabled}
                                    aria-label={`Call ${ci + 1} distance`}
                                  />
                                </td>
                                <td className="c-unit">
                                  <select
                                    value={String(
                                      call.unit ?? sheet.units_default ?? "feet",
                                    )}
                                    onChange={(e) =>
                                      setCall(ti, ci, { unit: e.target.value })
                                    }
                                    disabled={disabled}
                                    aria-label={`Call ${ci + 1} unit`}
                                  >
                                    {UNITS.map((u) => (
                                      <option key={u} value={u}>
                                        {u}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    className="in-mon"
                                    value={call.monument ?? ""}
                                    placeholder="—"
                                    onChange={(e) =>
                                      setCall(ti, ci, { monument: e.target.value })
                                    }
                                    disabled={disabled}
                                    aria-label={`Call ${ci + 1} monument`}
                                  />
                                </td>
                              </>
                            )}

                            <td className="c-conf">
                              {call.edited ? (
                                <span className="chip chip-info">edited</span>
                              ) : (
                                confidenceChip(call.confidence, ocrMode)
                              )}
                            </td>
                            <td className="c-act">
                              <div className="row-actions">
                                <button
                                  type="button"
                                  onClick={() => move(ti, ci, -1)}
                                  disabled={disabled || ci === 0}
                                  title="Move up"
                                  aria-label={`Move call ${ci + 1} up`}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => move(ti, ci, 1)}
                                  disabled={disabled || ci === calls.length - 1}
                                  title="Move down"
                                  aria-label={`Move call ${ci + 1} down`}
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => remove(ti, ci)}
                                  disabled={disabled}
                                  title="Delete call"
                                  aria-label={`Delete call ${ci + 1}`}
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {calls.length === 0 && (
                        <tr>
                          <td colSpan={8} className="empty-calls">
                            No calls. Add one, or return to the paste flow.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {calls.some((c) => c.source_text) && (
                  <details className="provenance">
                    <summary>Source text per call, as read from the document</summary>
                    <ol>
                      {calls.map((c, ci) => (
                        <li key={ci}>
                          {c.source_text ? (
                            <span>“{c.source_text}”</span>
                          ) : (
                            <span className="muted">— no source text recorded —</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                <button
                  type="button"
                  className="btn-secondary btn-add"
                  onClick={() => add(ti)}
                  disabled={disabled}
                >
                  + Add call
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
