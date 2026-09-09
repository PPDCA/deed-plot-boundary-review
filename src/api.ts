import type {
  CallSheet,
  Capabilities,
  CombineRequest,
  CombinedPlotResult,
  ExtractResult,
  FeedbackRecord,
  FeedbackStatus,
  PlotResult,
  Sample,
  TractVertexTable,
  VerificationVote,
} from "./types";

/** Turn any non-2xx into a message fit for the UI. Never surfaces a traceback. */
async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;

  let detail = "";
  try {
    const body = await res.json();
    detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? "");
  } catch {
    detail = await res.text().catch(() => "");
  }

  if (!detail) {
    detail =
      res.status >= 500
        ? "The service failed while handling the request."
        : `Request failed with status ${res.status}.`;
  }
  throw new Error(detail);
}

function networkMessage(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(
      "Could not reach the plotting service. Confirm the backend is running on port 8000.",
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function fetchSamples(): Promise<Sample[]> {
  try {
    const res = await fetch("/api/samples");
    const data = await unwrap<{ samples: Sample[] }>(res);
    return data.samples;
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function plotLegalText(legalText: string, title?: string): Promise<PlotResult> {
  try {
    const res = await fetch("/api/plot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legal_text: legalText, title }),
    });
    return await unwrap<PlotResult>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function plotCallsheet(callsheet: unknown): Promise<PlotResult> {
  try {
    const res = await fetch("/api/plot-callsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callsheet }),
    });
    return await unwrap<PlotResult>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function extractDeed(file: File): Promise<ExtractResult> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/extract", { method: "POST", body: form });
    return await unwrap<ExtractResult>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function validateAndPlot(callSheet: CallSheet): Promise<PlotResult> {
  try {
    const res = await fetch("/api/validate-and-plot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_sheet: callSheet }),
    });
    return await unwrap<PlotResult>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

/** Transcribe pasted prose without plotting it — the combine flow's paste path. */
export async function extractLegalText(
  legalText: string,
  title?: string,
  documentIndex?: number,
): Promise<ExtractResult> {
  try {
    const res = await fetch("/api/extract-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legal_text: legalText,
        title,
        document_index: documentIndex,
      }),
    });
    return await unwrap<ExtractResult>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function combineAndPlot(req: CombineRequest): Promise<CombinedPlotResult> {
  try {
    const res = await fetch("/api/combine-and-plot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return await unwrap<CombinedPlotResult>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

/** Structural check on a call sheet loaded from a file, before it is plotted. */
export async function validateCallSheet(
  callSheet: CallSheet,
): Promise<{ validation: string[]; tract_count: number }> {
  try {
    const res = await fetch("/api/validate-callsheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_sheet: callSheet }),
    });
    return await unwrap<{ validation: string[]; tract_count: number }>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

/** Describe every vertex of every tract in the workspace, so the anchor picker
    can say which corner each vertex number is. Read-only; runs no plot. */
export async function fetchTractVertices(
  req: CombineRequest,
): Promise<TractVertexTable[]> {
  try {
    const res = await fetch("/api/tract-vertices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const data = await unwrap<{ tracts: TractVertexTable[] }>(res);
    return data.tracts;
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    const res = await fetch("/api/capabilities");
    return await unwrap<Capabilities>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

/* ---------- tester feedback ---------- */

export async function submitFeedback(
  name: string,
  message: string,
  attachments: File[] = [],
): Promise<FeedbackRecord> {
  const form = new FormData();
  form.append("name", name);
  form.append("message", message);
  // Repeated parts under one field name -- FastAPI collects them into a list.
  for (const file of attachments) form.append("attachments", file);
  try {
    const res = await fetch("/api/feedback", { method: "POST", body: form });
    return await unwrap<FeedbackRecord>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function fetchFeedback(): Promise<FeedbackRecord[]> {
  try {
    const res = await fetch("/api/feedback");
    const data = await unwrap<{ feedback: FeedbackRecord[] }>(res);
    return data.feedback;
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function setFeedbackStatus(
  id: string,
  status: FeedbackStatus,
  adminKey: string,
): Promise<FeedbackRecord> {
  try {
    const res = await fetch(`/api/feedback/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, admin_key: adminKey }),
    });
    return await unwrap<FeedbackRecord>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function verifyFeedback(
  id: string,
  name: string,
  vote: VerificationVote,
): Promise<FeedbackRecord> {
  try {
    const res = await fetch(`/api/feedback/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, vote }),
    });
    return await unwrap<FeedbackRecord>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}

export async function deleteFeedback(id: string, adminKey: string): Promise<void> {
  try {
    const res = await fetch(`/api/feedback/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_key: adminKey }),
    });
    await unwrap<{ deleted: boolean; id: string }>(res);
  } catch (err) {
    throw networkMessage(err);
  }
}
