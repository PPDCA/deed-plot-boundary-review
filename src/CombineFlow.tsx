import { useEffect, useMemo, useRef, useState } from "react";
import {
  combineAndPlot,
  extractDeed,
  extractLegalText,
  fetchTractVertices,
  validateCallSheet,
} from "./api";
import CallEditor from "./CallEditor";
import Results from "./Results";
import TractColorPicker from "./TractColorPicker";
import type {
  CallSheet,
  CombineDocumentSpec,
  CombinedPlotResult,
  DocumentSource,
  EditableCall,
  ExtractResult,
  Placement,
  Tract,
  TractVertex,
  TractVertexTable,
} from "./types";

/* Combining two or more documents into one exhibit.

   Each document is transcribed on its own -- one request per document, never
   several documents in one prompt -- and the call sheets are held here until
   the reviewer has said where each new tract belongs. Only then are they merged
   and plotted, by the same engine path a single-document plot uses.

   The one piece of geometry this screen owns is the *choice* the schema already
   supports: a tract's `start` is either its own point of beginning or
   `{from_tract, at_vertex}` onto a tract already in the plot. Nothing here
   computes a coordinate. */

/** One document held in the workspace, with its per-tract placement. */
export interface CombineDoc {
  id: string;
  label: string;
  source: DocumentSource;
  /** Reviewed and possibly corrected. What actually gets merged. */
  sheet: CallSheet;
  /** The transcription as it arrived, for "revert". */
  original: CallSheet;
  /** Upload/paste metadata. Absent for a document seeded from a Flow 1 plot. */
  extraction: ExtractResult | null;
  /** Structural problems with this document's sheet, from whichever path
      produced it -- a transcription or a loaded call sheet file. */
  validation: string[];
  placements: PlacementState[];
  open: boolean;
}

interface PlacementState {
  /** Final tract name in the combined sheet. Editable, and must be unique. */
  name: string;
  mode: Placement;
  fromDocId: string | null;
  fromTractIndex: number;
  atVertex: number;
}

/** A document handed over from Flow 1 or Flow 2 to start the workspace off. */
export interface CombineSeed {
  label: string;
  source: DocumentSource;
  sheet: CallSheet;
  extraction?: ExtractResult | null;
}

interface Props {
  seed?: CombineSeed | null;
  /** Called once the seed has been taken up, so it is not re-applied. */
  onSeedConsumed?: () => void;
}

const PASTE_STEPS = [
  "Reading the description",
  "Transcribing courses",
  "Verifying the transcription",
];
const UPLOAD_STEPS = [
  "Reading the document",
  "Locating the legal description",
  "Transcribing courses",
  "Verifying the transcription",
];

let seq = 0;
function newId() {
  seq += 1;
  return `doc-${Date.now().toString(36)}-${seq}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function tractsOf(sheet: CallSheet): Tract[] {
  return sheet.tracts ?? [];
}

function tractName(tract: Tract, index: number) {
  return String(tract.name ?? "").trim() || `Tract ${index + 1}`;
}

function isAliquot(tract: Tract) {
  return String(tract.type ?? "").toLowerCase() === "aliquot" || !!tract.plss;
}

/** The same "(Doc n)" convention the backend applies, run early so the
    reviewer sees the final name -- and can override it -- before plotting. */
function disambiguate(name: string, taken: Set<string>, docNo: number) {
  if (!taken.has(name)) return name;
  let candidate = `${name} (Doc ${docNo})`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${name} (Doc ${docNo}-${suffix})`;
    suffix += 1;
  }
  return candidate;
}

function countCalls(sheet: CallSheet) {
  return tractsOf(sheet).reduce((n, t) => n + (t.calls?.length ?? 0), 0);
}

function callBrief(call: EditableCall) {
  const type = String(call.type ?? "line").toLowerCase();
  if (["unknown", "indeterminate", "meander", "gap"].includes(type)) {
    return "indeterminate call";
  }
  if (type === "curve" || type === "arc") {
    return `curve, R=${call.radius ?? "?"}`;
  }
  const bearing = String(call.bearing ?? call.azimuth ?? "").trim();
  const dist = call.distance == null ? "" : `${call.distance}`;
  return [bearing, dist].filter(Boolean).join("  ") || "call";
}

/** Vertex numbers a tract offers for anchoring, from the calls alone.

    Mirrors the engine's own numbering: vertex 0 is the tract's point of
    beginning and each call adds one -- except a tie line, which is drawn but
    contributes no boundary vertex. Used until the geometry arrives from
    /api/tract-vertices, and as the fallback if it cannot be computed. */
function vertexOptions(tract: Tract) {
  const out = [{ value: 0, label: "0 — point of beginning" }];
  let v = 0;
  (tract.calls ?? []).forEach((call, i) => {
    if (String(call.type ?? "line").toLowerCase() === "tie") return;
    v += 1;
    out.push({ value: v, label: `${v} — end of call ${i + 1}: ${callBrief(call)}` });
  });
  return out;
}

function feet(n: number) {
  return `${Math.round(n).toLocaleString()}′`;
}

/** A vertex named the way a deed names one: which corner it is, and how to
    walk to it from the tract's point of beginning. This is the whole point of
    the geometry round-trip -- "vertex 3" cannot be checked against "the
    northeast corner thereof", but "NE corner, 867′ at N 47°45′ E" can. */
function describeVertex(v: TractVertex) {
  if (v.n === 0) {
    return `point of beginning${v.corner ? ` (${v.corner} corner)` : ""}`;
  }
  if (v.closes_on_pob) {
    return `back at the point of beginning${
      v.after_call ? ` · end of call ${v.after_call}` : ""
    }`;
  }
  const where = [
    v.corner ? `${v.corner} corner` : null,
    v.bearing_from_pob
      ? `${feet(v.distance_from_pob)} ${v.bearing_from_pob} from the POB`
      : null,
    v.after_call ? `end of call ${v.after_call}` : null,
  ].filter(Boolean);
  return where.join(" · ");
}

function geometryVertexOptions(vertices: TractVertex[]) {
  return vertices.map((v) => ({ value: v.n, label: `${v.n} — ${describeVertex(v)}` }));
}

/** A signature of everything the vertex geometry depends on, so the round-trip
    is repeated when the calls change and not when anything else does. */
function geometrySignature(docs: CombineDoc[]) {
  return JSON.stringify(
    docs.map((d) => [
      d.id,
      tractsOf(d.sheet).map((t) => [t.name, t.start, t.type, t.plss, t.calls]),
    ]),
  );
}

/** What the transcription itself said about where a tract starts. */
function describeExtractedStart(tract: Tract) {
  const start = (tract.start ?? {}) as Record<string, unknown>;
  if (start.from_tract) {
    return `anchored to “${String(start.from_tract)}” at vertex ${
      Number(start.at_vertex ?? 0)
    }, as this document describes it`;
  }
  return "its own point of beginning";
}

export default function CombineFlow({ seed, onSeedConsumed }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<CombineDoc[]>([]);
  const [adding, setAdding] = useState<null | "paste" | "upload" | "callsheet">(
    null,
  );
  const [pasteText, setPasteText] = useState("");
  const [pasteName, setPasteName] = useState("");

  const [busy, setBusy] = useState<null | { label: string; steps: string[] }>(null);
  const [step, setStep] = useState(0);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [plotting, setPlotting] = useState(false);
  const [plotError, setPlotError] = useState<string | null>(null);
  const [result, setResult] = useState<CombinedPlotResult | null>(null);

  /** Append a transcribed call sheet as the next document in the plot. */
  function appendDoc(
    label: string,
    source: DocumentSource,
    sheet: CallSheet,
    extraction: ExtractResult | null,
    validation: string[] = [],
  ) {
    setDocs((prev) => {
      const taken = new Set<string>();
      for (const d of prev) for (const p of d.placements) taken.add(p.name);
      const docNo = prev.length + 1;

      const placements: PlacementState[] = tractsOf(sheet).map((tract, ti) => {
        const name = disambiguate(tractName(tract, ti), taken, docNo);
        taken.add(name);
        const start = (tract.start ?? {}) as Record<string, unknown>;
        // A tract the transcription anchored onto a sibling in the same
        // document keeps that anchoring by default -- it came from the words.
        // Everything else in an added document is an explicit user choice, and
        // "stand alone" is the honest default: it plots, and it never quietly
        // puts a boundary somewhere the reviewer did not ask for.
        const mode: Placement =
          start.from_tract != null ? "keep" : prev.length === 0 ? "keep" : "fresh";
        return {
          name,
          mode,
          fromDocId: prev.length > 0 ? prev[prev.length - 1].id : null,
          fromTractIndex: 0,
          atVertex: 0,
        };
      });

      return [
        ...prev,
        {
          id: newId(),
          label,
          source,
          sheet: clone(sheet),
          original: clone(sheet),
          extraction,
          validation: extraction ? extraction.validation : validation,
          placements,
          // The first document arrives reviewed (or plotted) already; a later
          // one is worth opening so the placement controls are in front of the
          // reviewer straight away.
          open: prev.length > 0,
        },
      ];
    });
    setResult(null);
    setPlotError(null);
  }

  // A document handed over from the paste or upload flow starts the workspace.
  // Keyed on the seed object itself: appending is not idempotent, and under
  // StrictMode the effect body runs twice for one commit.
  const seeded = useRef<CombineSeed | null>(null);
  useEffect(() => {
    if (!seed || seeded.current === seed) return;
    seeded.current = seed;
    appendDoc(seed.label, seed.source, seed.sheet, seed.extraction ?? null);
    onSeedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  /* The engine is the only thing that knows where a vertex actually is -- the
     traverse handles bearings, curves, ties and units. So the corner identities
     are fetched rather than recomputed here. Keyed on a signature of the calls,
     and debounced, so editing a call in the review table does not fire a
     request per keystroke. */
  const [vertexTables, setVertexTables] = useState<{
    signature: string;
    tables: TractVertexTable[];
  } | null>(null);
  const signature = useMemo(() => geometrySignature(docs), [docs]);

  useEffect(() => {
    if (docs.length === 0) {
      setVertexTables(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      fetchTractVertices({
        documents: docs.map((d) => ({
          label: d.label,
          source: d.source,
          call_sheet: d.sheet,
          tracts: [],
        })),
      })
        .then((tables) => {
          if (live) setVertexTables({ signature, tables });
        })
        // A failure here only costs the corner names: the picker falls back to
        // numbering the calls, which is still plottable.
        .catch(() => {
          if (live) setVertexTables(null);
        });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /** The geometry table for one tract, or null while it is stale or missing. */
  function verticesFor(docIndex: number, tractIndex: number) {
    if (!vertexTables || vertexTables.signature !== signature) return null;
    const hit = vertexTables.tables.find(
      (t) => t.document === docIndex && t.tract_index === tractIndex,
    );
    return hit && hit.vertices.length > 0 ? hit.vertices : null;
  }

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const timer = setInterval(
      () => setStep((s) => Math.min(s + 1, busy.steps.length - 1)),
      2800,
    );
    return () => clearInterval(timer);
  }, [busy]);

  function patchDoc(id: string, fn: (draft: CombineDoc) => void) {
    setDocs((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const draft: CombineDoc = { ...d, placements: d.placements.map((p) => ({ ...p })) };
        fn(draft);
        return draft;
      }),
    );
  }

  function setPlacement(id: string, ti: number, patch: Partial<PlacementState>) {
    patchDoc(id, (d) => {
      d.placements[ti] = { ...d.placements[ti], ...patch };
    });
    setResult(null);
  }

  /** CallEditor edits the sheet, including the tract's own name. Keep the
      placement's final name in step unless the reviewer has renamed it there. */
  function onSheetChange(id: string, next: CallSheet) {
    patchDoc(id, (d) => {
      const before = tractsOf(d.sheet);
      d.sheet = next;
      tractsOf(next).forEach((tract, ti) => {
        const old = before[ti] ? tractName(before[ti], ti) : null;
        const now = tractName(tract, ti);
        if (old !== null && old !== now && d.placements[ti]?.name === old) {
          d.placements[ti] = { ...d.placements[ti], name: now };
        }
      });
    });
    setResult(null);
  }

  function removeDoc(id: string) {
    setDocs((prev) => {
      const gone = prev.find((d) => d.id === id);
      const kept = prev.filter((d) => d.id !== id);
      const orphaned: string[] = [];
      const next = kept.map((d) => ({
        ...d,
        placements: d.placements.map((p) => {
          if (p.mode === "anchor" && p.fromDocId === id) {
            orphaned.push(p.name);
            return { ...p, mode: "fresh" as Placement, fromDocId: null, atVertex: 0 };
          }
          return p;
        }),
      }));
      setNotice(
        orphaned.length > 0
          ? `Removed “${gone?.label}”. ${orphaned.join(", ")} ${
              orphaned.length === 1 ? "was" : "were"
            } attached to it, so ${
              orphaned.length === 1 ? "it now stands" : "they now stand"
            } alone — set the attachment again if that is not what you want.`
          : `Removed “${gone?.label}”.`,
      );
      return next;
    });
    setResult(null);
    setPlotError(null);
  }

  async function runPaste() {
    const label = pasteName.trim() || `Pasted description ${docs.length + 1}`;
    setAddError(null);
    setNotice(null);
    setBusy({ label: `Transcribing “${label}”`, steps: PASTE_STEPS });
    try {
      const res = await extractLegalText(pasteText, label, docs.length);
      appendDoc(label, "paste", res.call_sheet, res);
      setPasteText("");
      setPasteName("");
      setAdding(null);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runUpload(file: File) {
    setAddError(null);
    setNotice(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setAddError(`“${file.name}” is not a PDF. This step reads PDF deeds.`);
      return;
    }
    setBusy({ label: `Reading “${file.name}”`, steps: UPLOAD_STEPS });
    try {
      const res = await extractDeed(file);
      appendDoc(file.name, "upload", res.call_sheet, res);
      setAdding(null);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  /** Load a call sheet saved from an earlier plot.

      This is the whole of "come back next week and add to it": the sheet is
      already structured, so there is nothing to transcribe and no LLM call to
      make. Its tracts join the workspace like any others and can be anchored
      onto, or anchored to. */
  async function runLoadCallSheet(file: File) {
    setAddError(null);
    setNotice(null);
    if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
      setAddError(
        `“${file.name}” is not a JSON call sheet. Use the file saved by ` +
          `“Download call sheet” under a plot.`,
      );
      return;
    }
    setBusy({ label: `Reading “${file.name}”`, steps: ["Reading the call sheet"] });
    try {
      const text = await file.text();
      let sheet: CallSheet;
      try {
        sheet = JSON.parse(text) as CallSheet;
      } catch (e) {
        throw new Error(
          `“${file.name}” is not valid JSON (${(e as Error).message}).`,
        );
      }
      if (
        !sheet || typeof sheet !== "object" ||
        !Array.isArray(sheet.tracts) || sheet.tracts.length === 0
      ) {
        throw new Error(
          `“${file.name}” has no tracts, so it is not a call sheet. ` +
            `Use the file saved by “Download call sheet” under a plot.`,
        );
      }
      // The engine's own structural check, so a hand-edited file reports its
      // problems now rather than at the moment the reviewer presses plot.
      const { validation } = await validateCallSheet(sheet);
      const label =
        String(
          (sheet.project as Record<string, unknown> | undefined)?.title ?? "",
        ).trim() || file.name;
      appendDoc(label, "callsheet", sheet, null, validation);
      setAdding(null);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setBusy(null);
      if (sheetInput.current) sheetInput.current.value = "";
    }
  }

  /* ---- what the combined plot will contain, computed from the workspace ---- */

  const flat = useMemo(
    () =>
      docs.flatMap((d, di) =>
        tractsOf(d.sheet).map((tract, ti) => ({
          docId: d.id,
          docIndex: di,
          docLabel: d.label,
          tractIndex: ti,
          tract,
          name: d.placements[ti]?.name ?? tractName(tract, ti),
        })),
      ),
    [docs],
  );

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const t of flat) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    return [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
  }, [flat]);

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (docs.length === 0) out.push("Add a document to plot.");
    for (const name of duplicates) {
      out.push(
        `Two tracts are both named “${name}”. Rename one — every tract in a ` +
          `combined plot needs its own name.`,
      );
    }
    for (const t of flat) {
      const p = docs[t.docIndex].placements[t.tractIndex];
      if (!p) continue;
      if (!p.name.trim()) out.push(`A tract from “${t.docLabel}” has no name.`);
      if (p.mode === "anchor" && !p.fromDocId) {
        out.push(`“${p.name}” is set to attach to a tract, but no tract is chosen.`);
      }
    }
    return out;
  }, [docs, flat, duplicates]);

  /** Tracts a given tract may attach to: everything placed before it. */
  function anchorTargets(docIndex: number, tractIndex: number) {
    return flat.filter(
      (t) =>
        t.docIndex < docIndex ||
        (t.docIndex === docIndex && t.tractIndex < tractIndex),
    );
  }

  async function plotCombined() {
    setPlotError(null);
    setResult(null);
    setPlotting(true);
    try {
      const documents: CombineDocumentSpec[] = docs.map((d) => ({
        label: d.label,
        source: d.source,
        call_sheet: d.sheet,
        tracts: d.placements.map((p, ti) => ({
          index: ti,
          name: p.name.trim(),
          placement: p.mode,
          anchor:
            p.mode === "anchor" && p.fromDocId
              ? {
                  from_document: docs.findIndex((x) => x.id === p.fromDocId),
                  from_tract_index: p.fromTractIndex,
                  at_vertex: p.atVertex,
                }
              : null,
        })),
      }));
      setResult(await combineAndPlot({ documents }));
    } catch (e) {
      setPlotError((e as Error).message);
    } finally {
      setPlotting(false);
    }
  }

  const working = busy !== null || plotting;
  const tractTotal = flat.length;

  return (
    <div className="wrap">
      <h1>Combine documents into one exhibit</h1>
      <p className="lede">
        Two instruments describing land that touches — a vesting deed and a later
        easement, a parent tract and the parcel taken out of it — are transcribed one
        at a time, each on its own. You then say where each new tract begins: on its own
        point of beginning, or at a numbered corner of a tract already on the plot. Only
        then is anything plotted, as a single exhibit with one QC report.
      </p>

      {/* ---------- documents added so far ---------- */}

      {docs.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <h2>Documents in this plot</h2>
            <span className="spacer" />
            <span className="section-label" style={{ margin: 0 }}>
              {docs.length} document{docs.length === 1 ? "" : "s"} · {tractTotal} tract
              {tractTotal === 1 ? "" : "s"} · merged in this order
            </span>
          </div>
          <div className="panel-body">
            <div style={{ overflowX: "auto" }}>
              <table className="doc-table">
                <thead>
                  <tr>
                    <th className="c-n">#</th>
                    <th>Document</th>
                    <th>Source</th>
                    <th className="num">Tracts</th>
                    <th className="num">Calls</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, di) => (
                    <tr key={d.id}>
                      <td className="c-n">{di + 1}</td>
                      <td className="dname">
                        {d.label}
                        {di === 0 && (
                          <span className="role">sets the coordinate origin</span>
                        )}
                      </td>
                      <td>
                        <span className="chip chip-info">
                          {d.source === "upload"
                            ? "uploaded PDF"
                            : d.source === "callsheet"
                              ? "saved call sheet"
                              : "pasted text"}
                        </span>
                        {d.extraction?.extraction_method === "ocr" && (
                          <span className="chip chip-medium">OCR</span>
                        )}
                      </td>
                      <td className="num">{tractsOf(d.sheet).length}</td>
                      <td className="num">{countCalls(d.sheet)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="btn-secondary sample-row"
                          onClick={() => patchDoc(d.id, (x) => (x.open = !x.open))}
                          disabled={working}
                        >
                          {d.open ? "Hide" : "Review"}
                        </button>{" "}
                        <button
                          className="btn-secondary sample-row"
                          onClick={() => removeDoc(d.id)}
                          disabled={working}
                          title="Remove this document from the combined plot"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="caveat" style={{ marginBottom: 14 }}>
          {notice}
        </div>
      )}

      {/* ---------- per-document review + placement ---------- */}

      {docs.map((d, di) => {
        if (!d.open) return null;
        const x = d.extraction;
        return (
          <div className="panel doc-panel" key={d.id} style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h2>
                {di + 1}. {d.label}
              </h2>
              <span className="spacer" />
              {x && x.extraction_method !== "pasted_text" && (
                <span
                  className={`chip ${
                    x.confidence === "low"
                      ? "chip-high"
                      : x.confidence === "medium"
                        ? "chip-medium"
                        : "chip-info"
                  }`}
                >
                  confidence: {x.confidence}
                </span>
              )}
              <button
                className="btn-secondary sample-row"
                onClick={() => patchDoc(d.id, (v) => (v.open = false))}
                disabled={working}
              >
                Collapse
              </button>
            </div>
            <div className="panel-body">
              {x?.note && (
                <div className="caveat" style={{ marginBottom: 14 }}>
                  <strong>From the transcription step:</strong> {x.note}
                </div>
              )}
              {d.validation.length > 0 && (
                <div className="error-box" style={{ marginBottom: 14 }}>
                  <strong>This document's call sheet has problems to fix below</strong>
                  <ul>
                    {d.validation.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="section-label">where each tract of this document begins</p>

              {tractsOf(d.sheet).map((tract, ti) => {
                const p = d.placements[ti];
                if (!p) return null;
                const first = di === 0 && ti === 0;
                const targets = anchorTargets(di, ti);
                const target =
                  targets.find(
                    (t) => t.docId === p.fromDocId && t.tractIndex === p.fromTractIndex,
                  ) ?? null;
                const geom = target
                  ? verticesFor(target.docIndex, target.tractIndex)
                  : null;
                const verts = target
                  ? geom
                    ? geometryVertexOptions(geom)
                    : vertexOptions(target.tract)
                  : [];
                const freeform = target != null && verts.length <= 1;
                const chosen = geom?.find((v) => v.n === p.atVertex) ?? null;
                // Attaching at vertex 0 of the tract that sets the origin lands
                // on exactly the point "start fresh" uses, so a wrong corner is
                // indistinguishable from no anchoring at all. Say so.
                const noop =
                  p.mode === "anchor" &&
                  target != null &&
                  target.docIndex === 0 &&
                  target.tractIndex === 0 &&
                  p.atVertex === 0 &&
                  !(target.tract.start as Record<string, unknown> | undefined)
                    ?.from_tract &&
                  Number(
                    (target.tract.start as Record<string, unknown>)?.x ?? 0,
                  ) === 0 &&
                  Number(
                    (target.tract.start as Record<string, unknown>)?.y ?? 0,
                  ) === 0;

                return (
                  <div className="place-block" key={ti}>
                    <div className="place-head">
                      <label className="place-name">
                        <span className="section-label" style={{ margin: 0 }}>
                          tract name in the combined plot
                        </span>
                        <input
                          className="in-name"
                          value={p.name}
                          onChange={(e) =>
                            setPlacement(d.id, ti, { name: e.target.value })
                          }
                          disabled={working}
                          aria-label={`Combined name for tract ${ti + 1} of ${d.label}`}
                        />
                      </label>
                      <TractColorPicker
                        tract={tract}
                        disabled={working}
                        onChange={(color) =>
                          patchDoc(d.id, (draft) => {
                            const next = clone(draft.sheet);
                            if (color === null) delete next.tracts[ti].color;
                            else next.tracts[ti].color = color;
                            draft.sheet = next;
                          })
                        }
                        label={`Colour for ${p.name}`}
                      />
                      <span className="spacer" />
                      <span className="chip chip-info">
                        {String(tract.role ?? "subject")}
                      </span>
                      {duplicates.includes(p.name) && (
                        <span className="chip chip-high">duplicate name</span>
                      )}
                    </div>

                    {first ? (
                      <p className="place-note">
                        The first tract of the first document sets the coordinate
                        origin — its point of beginning is the plot's POB, and
                        everything else is positioned relative to it.
                      </p>
                    ) : (
                      <div className="place-opts">
                        <label>
                          <input
                            type="radio"
                            name={`${d.id}-${ti}-mode`}
                            checked={p.mode === "keep"}
                            onChange={() => setPlacement(d.id, ti, { mode: "keep" })}
                            disabled={working}
                          />
                          <span>
                            <strong>As transcribed</strong>
                            <em>{describeExtractedStart(tract)}</em>
                          </span>
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`${d.id}-${ti}-mode`}
                            checked={p.mode === "fresh"}
                            onChange={() => setPlacement(d.id, ti, { mode: "fresh" })}
                            disabled={working}
                          />
                          <span>
                            <strong>Start fresh</strong>
                            <em>
                              its own point of beginning at 0,0 — drawn alongside the
                              others, not joined to them
                            </em>
                          </span>
                        </label>
                        <label>
                          <input
                            type="radio"
                            name={`${d.id}-${ti}-mode`}
                            checked={p.mode === "anchor"}
                            onChange={() =>
                              setPlacement(d.id, ti, {
                                mode: "anchor",
                                // land on a real target so the choice is never
                                // half-made
                                fromDocId: (target ?? targets[0]).docId,
                                fromTractIndex: (target ?? targets[0]).tractIndex,
                                atVertex: target ? p.atVertex : 0,
                              })
                            }
                            disabled={working || targets.length === 0}
                          />
                          <span>
                            <strong>Attach to an existing tract</strong>
                            <em>
                              {targets.length === 0
                                ? "nothing is placed ahead of this tract yet"
                                : "begin at a numbered corner of a tract already in the plot"}
                            </em>
                          </span>
                        </label>
                      </div>
                    )}

                    {!first && p.mode === "anchor" && targets.length > 0 && (
                      <div className="anchor-row">
                        <label>
                          <span className="section-label" style={{ margin: 0 }}>
                            attach to
                          </span>
                          <select
                            value={
                              target
                                ? `${target.docId}::${target.tractIndex}`
                                : `${targets[0].docId}::${targets[0].tractIndex}`
                            }
                            onChange={(e) => {
                              const [docId, idx] = e.target.value.split("::");
                              setPlacement(d.id, ti, {
                                fromDocId: docId,
                                fromTractIndex: Number(idx),
                                atVertex: 0,
                              });
                            }}
                            disabled={working}
                            aria-label={`Anchor tract for ${p.name}`}
                          >
                            {targets.map((t) => (
                              <option
                                key={`${t.docId}::${t.tractIndex}`}
                                value={`${t.docId}::${t.tractIndex}`}
                              >
                                {t.name} — doc {t.docIndex + 1}, {t.docLabel}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="section-label" style={{ margin: 0 }}>
                            at vertex
                          </span>
                          {freeform ? (
                            <input
                              className="in-num"
                              type="number"
                              min={0}
                              step={1}
                              value={p.atVertex}
                              onChange={(e) =>
                                setPlacement(d.id, ti, {
                                  atVertex: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              disabled={working}
                              aria-label={`Anchor vertex for ${p.name}`}
                            />
                          ) : (
                            <select
                              value={p.atVertex}
                              onChange={(e) =>
                                setPlacement(d.id, ti, { atVertex: Number(e.target.value) })
                              }
                              disabled={working}
                              aria-label={`Anchor vertex for ${p.name}`}
                            >
                              {verts.map((v) => (
                                <option key={v.value} value={v.value}>
                                  {v.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                        {target && (
                          <p className="place-note" style={{ margin: 0 }}>
                            {chosen ? (
                              <>
                                “{p.name}” will begin at the{" "}
                                <strong>{describeVertex(chosen)}</strong> of “
                                {target.name}”. Check that against what the
                                description recites.
                              </>
                            ) : isAliquot(target.tract) ? (
                              "Aliquot tract — its vertices are the nominal section corners, numbered from the southwest."
                            ) : (
                              `Vertex 0 is “${target.name}”'s point of beginning; each call adds one. A tie line adds none.`
                            )}
                          </p>
                        )}
                        {noop && (
                          <p className="place-warn">
                            Vertex 0 of “{target?.name}” <em>is</em> the plot's
                            origin, so this attaches the tract at the very point
                            “Start fresh” would use — the two plot identically.
                            If the description begins at a particular corner,
                            choose that corner above; a wrong corner looks
                            exactly like no attachment at all.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <p className="section-label" style={{ marginTop: 18 }}>
                extracted calls — check against the document
              </p>
              <CallEditor
                sheet={d.sheet}
                onChange={(next) => onSheetChange(d.id, next)}
                disabled={working}
                ocrMode={x?.extraction_method === "ocr"}
              />
              <div className="field-row" style={{ marginTop: 12 }}>
                <button
                  className="btn-secondary"
                  onClick={() => patchDoc(d.id, (v) => (v.sheet = clone(v.original)))}
                  disabled={working}
                >
                  Revert to transcription
                </button>
                {x?.raw_text && (
                  <details className="provenance" style={{ flex: 1 }}>
                    <summary>
                      {d.source === "upload"
                        ? "Document text, as read from the PDF"
                        : "Text as pasted"}
                    </summary>
                    <pre className="raw-text">{x.raw_text}</pre>
                  </details>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* ---------- add a document ---------- */}

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <h2>{docs.length === 0 ? "Add the first document" : "Add another document"}</h2>
          <span className="spacer" />
          <span className="section-label" style={{ margin: 0 }}>
            transcribed on its own, then placed
          </span>
        </div>
        <div className="panel-body">
          {adding === null ? (
            <div className="field-row">
              <button
                className="btn"
                onClick={() => {
                  setAdding("paste");
                  setAddError(null);
                }}
                disabled={working}
              >
                Paste a description
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setAdding("upload");
                  setAddError(null);
                }}
                disabled={working}
              >
                Upload a deed PDF
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  setAdding("callsheet");
                  setAddError(null);
                }}
                disabled={working}
                title="Reopen a call sheet saved from an earlier plot — no transcription needed"
              >
                Load a saved call sheet
              </button>
              <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                A pasted or uploaded document is transcribed separately — around
                20–40 seconds each. A saved call sheet is already structured and
                loads at once.
              </span>
            </div>
          ) : adding === "callsheet" ? (
            <>
              <div className="dropzone">
                <input
                  ref={sheetInput}
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) runLoadCallSheet(f);
                  }}
                  disabled={working}
                  id="combine-callsheet"
                  className="visually-hidden"
                />
                <p className="dz-main">Reopen a saved call sheet</p>
                <p className="dz-sub">
                  <label htmlFor="combine-callsheet" className="link-label">
                    choose a .json file
                  </label>
                  . Saved by “Download call sheet” under any plot.
                </p>
                <p className="dz-cap">
                  Already structured, so nothing is re-transcribed — the tracts you
                  plotted before come back exactly as they were, ready for another
                  document to be anchored onto them.
                </p>
              </div>
              <div className="field-row" style={{ marginTop: 10 }}>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setAdding(null);
                    setAddError(null);
                  }}
                  disabled={working}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : adding === "paste" ? (
            <>
              <label className="doc-name-field">
                <span className="section-label" style={{ margin: 0 }}>
                  what this document is
                </span>
                <input
                  className="in-name"
                  value={pasteName}
                  placeholder={`Pasted description ${docs.length + 1}`}
                  onChange={(e) => setPasteName(e.target.value)}
                  disabled={working}
                  aria-label="Document name"
                />
              </label>
              <textarea
                className="legal"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  "Paste ONE document's legal description here. To combine a second " +
                  "instrument, add it as its own document — it is transcribed on its " +
                  "own and you choose where it attaches."
                }
                spellCheck={false}
                disabled={working}
              />
              <div className="field-row" style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  onClick={runPaste}
                  disabled={working || pasteText.trim().length === 0}
                >
                  {busy ? "Transcribing…" : "Transcribe & add"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setAdding(null);
                    setPasteText("");
                    setPasteName("");
                    setAddError(null);
                  }}
                  disabled={working}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="dropzone">
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) runUpload(f);
                  }}
                  disabled={working}
                  id="combine-file"
                  className="visually-hidden"
                />
                <p className="dz-main">Add a deed PDF</p>
                <p className="dz-sub">
                  <label htmlFor="combine-file" className="link-label">
                    choose a file
                  </label>
                  . Text-based or scanned.
                </p>
              </div>
              <div className="field-row" style={{ marginTop: 10 }}>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setAdding(null);
                    setAddError(null);
                  }}
                  disabled={working}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {busy && (
        <div className="status">
          <span className="spinner" />
          <div>
            <div>{busy.label}…</div>
            <ul className="steps">
              {busy.steps.map((s, i) => (
                <li key={s} className={i < step ? "done" : i === step ? "active" : ""}>
                  {i < step ? "✓ " : i === step ? "› " : "  "}
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {addError && (
        <div className="error-box">
          <strong>Could not add that document</strong>
          <p>{addError}</p>
        </div>
      )}

      {/* ---------- combine ---------- */}

      {docs.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Plot the combined exhibit</h2>
            <span className="spacer" />
            <span className="section-label" style={{ margin: 0 }}>
              one exhibit, one QC report
            </span>
          </div>
          <div className="panel-body">
            {blockers.length > 0 && (
              <div className="error-box" style={{ marginBottom: 14 }}>
                <strong>Resolve these before plotting</strong>
                <ul>
                  {blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="field-row">
              <button
                className="btn"
                onClick={plotCombined}
                disabled={working || blockers.length > 0}
              >
                {plotting
                  ? "Plotting…"
                  : `Plot combined — ${docs.length} document${
                      docs.length === 1 ? "" : "s"
                    }, ${tractTotal} tract${tractTotal === 1 ? "" : "s"}`}
              </button>
              {docs.length === 1 && (
                <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                  One document plots exactly as it would on its own.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {plotting && (
        <div className="status" style={{ marginTop: 14 }}>
          <span className="spinner" />
          <div>Merging the call sheets and checking the combined geometry…</div>
        </div>
      )}

      {plotError && (
        <div className="error-box" style={{ marginTop: 14 }}>
          <strong>Could not plot the combined documents</strong>
          <p>{plotError}</p>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 18 }}>
          {(result.combined.renamed.length > 0 ||
            result.combined.anchors.length > 0) && (
            <div className="caveat" style={{ marginBottom: 14 }}>
              <strong>How this exhibit was assembled:</strong>{" "}
              {result.combined.document_labels.join(" → ")}.
              {result.combined.anchors.length > 0 && (
                <>
                  {" "}
                  {result.combined.anchors
                    .map(
                      (a) =>
                        `${a.tract} begins at vertex ${a.at_vertex} of ${a.from_tract}` +
                        (a.as_described ? " (as its document describes it)" : ""),
                    )
                    .join("; ")}
                  .
                </>
              )}
              {result.combined.renamed.length > 0 && (
                <>
                  {" "}
                  Renamed to keep tract names distinct:{" "}
                  {result.combined.renamed
                    .map((r) => `“${r.from}” → “${r.to}”`)
                    .join(", ")}
                  .
                </>
              )}
            </div>
          )}
          <Results result={result} />
        </div>
      )}
    </div>
  );
}
