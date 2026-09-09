import { useCallback, useEffect, useRef, useState } from "react";
import { deleteFeedback, fetchFeedback, setFeedbackStatus, verifyFeedback } from "./api";
import type { FeedbackRecord, VerificationVote } from "./types";

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

/** The name the widget remembered, so a tester need not retype it to vote. */
const REMEMBERED_NAME = "deedplot.feedbackName";

function rememberedName(): string {
  try {
    return localStorage.getItem(REMEMBERED_NAME) ?? "";
  } catch {
    return "";
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One submission: the original display, plus status and re-test controls. */
function FeedbackItem({
  record,
  onUpdated,
  onDeleted,
}: {
  record: FeedbackRecord;
  onUpdated: (updated: FeedbackRecord) => void;
  onDeleted: (id: string) => void;
}) {
  // Which admin action the key is being entered for. One input serves both, so
  // opening one closes the other and a typed key never carries across.
  const [adminMode, setAdminMode] = useState<null | "status" | "delete">(null);
  const [adminKey, setAdminKey] = useState("");
  const [voterName, setVoterName] = useState(rememberedName);
  const [busy, setBusy] = useState<null | "status" | "delete" | VerificationVote>(null);
  const [error, setError] = useState<string | null>(null);
  const [showVotes, setShowVotes] = useState(false);

  const incorporated = record.status === "incorporated";
  const tally = record.verification_summary;
  const fileCount = record.attachment_urls.length;

  function closeAdmin() {
    setAdminMode(null);
    setAdminKey("");
    setError(null);
  }

  function openAdmin(mode: "status" | "delete") {
    setAdminMode(mode);
    setAdminKey("");
    setError(null);
  }

  async function changeStatus(next: "open" | "incorporated") {
    setError(null);
    if (!adminKey.trim()) {
      setError("Enter the admin key.");
      return;
    }
    setBusy("status");
    try {
      onUpdated(await setFeedbackStatus(record.id, next, adminKey.trim()));
      closeAdmin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Permanent: the record and its files. The warning above the button is the
   * confirmation step -- this only runs on a deliberate second click. */
  async function remove() {
    setError(null);
    if (!adminKey.trim()) {
      setError("Enter the admin key.");
      return;
    }
    setBusy("delete");
    try {
      await deleteFeedback(record.id, adminKey.trim());
      // The row goes away, so there is no state left here worth clearing.
      onDeleted(record.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function vote(v: VerificationVote) {
    setError(null);
    if (!voterName.trim()) {
      setError("Enter your name so the vote is attributable.");
      return;
    }
    setBusy(v);
    try {
      onUpdated(await verifyFeedback(record.id, voterName.trim(), v));
      try {
        localStorage.setItem(REMEMBERED_NAME, voterName.trim());
      } catch {
        // A blocked localStorage must not cost the tester their vote.
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="fb-item">
      <div className="fb-item-head">
        <strong className="fb-name">{record.name}</strong>
        <span className="fb-when">{formatWhen(record.created_at)}</span>
        <span className="spacer" />
        <span className={incorporated ? "chip chip-info" : "chip chip-neutral"}>
          {incorporated ? "Incorporated" : "Open"}
        </span>
      </div>

      <p className="fb-message">{record.message}</p>

      {record.attachment_urls.length > 0 && (
        <div className="fb-attach">
          {record.attachment_urls.map((a) => (
            <a
              key={a.url}
              className="fb-attach-item"
              href={a.url}
              target="_blank"
              rel="noreferrer"
              title={a.filename}
            >
              {IMAGE_RE.test(a.filename) ? (
                <img className="fb-thumb" src={a.url} alt={a.filename} />
              ) : (
                <span className="fb-thumb fb-thumb-doc" aria-hidden="true">
                  PDF
                </span>
              )}
              <span className="fb-attach-link">{a.filename || "attachment"}</span>
            </a>
          ))}
        </div>
      )}

      {incorporated && (
        <div className="fb-retest">
          <p className="fb-retest-ask">This was addressed — please re-test and let us know.</p>
          <div className="field-row">
            <input
              className="fb-input fb-input-inline"
              value={voterName}
              onChange={(e) => setVoterName(e.target.value)}
              placeholder="Your name"
              maxLength={120}
              aria-label="Your name"
              disabled={busy !== null}
            />
            <button
              className="btn-secondary fb-vote"
              onClick={() => void vote("working")}
              disabled={busy !== null}
            >
              {busy === "working" ? "Recording…" : "✅ Working"}
            </button>
            <button
              className="btn-secondary fb-vote"
              onClick={() => void vote("not_working")}
              disabled={busy !== null}
            >
              {busy === "not_working" ? "Recording…" : "❌ Not working"}
            </button>
          </div>
        </div>
      )}

      {tally.total > 0 && (
        <div className="fb-tally">
          <span className="fb-tally-count">
            <strong>{tally.working}</strong> said Working
          </span>
          <span className="fb-tally-sep">·</span>
          <span className="fb-tally-count">
            <strong>{tally.not_working}</strong> said Not working
          </span>
          <button className="fb-toggle" onClick={() => setShowVotes((v) => !v)}>
            {showVotes ? "hide who" : "show who"}
          </button>
        </div>
      )}

      {showVotes && tally.total > 0 && (
        <ul className="fb-votes">
          {record.verifications.map((v, i) => (
            <li key={`${v.name}-${v.created_at}-${i}`}>
              <span className={v.vote === "working" ? "fb-vote-ok" : "fb-vote-bad"}>
                {v.vote === "working" ? "✅ working" : "❌ not working"}
              </span>{" "}
              — {v.name}
              {v.created_at && <span className="fb-when"> {formatWhen(v.created_at)}</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="fb-admin">
        {adminMode === "status" ? (
          <div className="field-row">
            <input
              className="fb-input fb-input-inline"
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void changeStatus(incorporated ? "open" : "incorporated");
                if (e.key === "Escape") closeAdmin();
              }}
              placeholder="Admin key"
              aria-label="Admin key"
              disabled={busy !== null}
            />
            <button
              className="btn-secondary fb-vote"
              onClick={() => void changeStatus(incorporated ? "open" : "incorporated")}
              disabled={busy !== null}
            >
              {busy === "status" ? "Saving…" : incorporated ? "Reopen" : "Confirm"}
            </button>
            <button className="fb-toggle" onClick={closeAdmin} disabled={busy !== null}>
              cancel
            </button>
          </div>
        ) : adminMode === "delete" ? (
          <div className="fb-danger">
            <p className="fb-danger-ask">
              Delete this feedback{fileCount > 0 && <> and its {fileCount} attached
              {" "}{fileCount === 1 ? "file" : "files"}</>}? This cannot be undone.
            </p>
            <div className="field-row">
              <input
                className="fb-input fb-input-inline"
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void remove();
                  if (e.key === "Escape") closeAdmin();
                }}
                placeholder="Admin key"
                aria-label="Admin key"
                disabled={busy !== null}
              />
              <button
                className="btn-danger fb-vote"
                onClick={() => void remove()}
                disabled={busy !== null}
              >
                {busy === "delete" ? "Deleting…" : "Delete permanently"}
              </button>
              <button className="fb-toggle" onClick={closeAdmin} disabled={busy !== null}>
                cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="field-row">
            <button className="fb-toggle" onClick={() => openAdmin("status")}>
              {incorporated ? "Reopen this item" : "Mark as incorporated"}
            </button>
            <span className="fb-tally-sep">·</span>
            <button className="fb-toggle fb-toggle-danger" onClick={() => openAdmin("delete")}>
              Delete
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="error-box fb-item-error">
          <strong>{adminMode === "delete" ? "Could not delete that" : "Could not save that"}</strong>
          <p>{error}</p>
        </div>
      )}
    </li>
  );
}

/** The open "All feedback" page: every tester's submissions, newest first. */
export default function FeedbackList({ reloadKey = 0 }: { reloadKey?: number }) {
  const [records, setRecords] = useState<FeedbackRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRecords(await fetchFeedback());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  // Splice the server's updated record in place rather than refetching, so a
  // vote does not reorder or collapse anything the tester was looking at.
  const replace = useCallback((updated: FeedbackRecord) => {
    setRecords((prev) =>
      prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev,
    );
  }, []);

  // Filtered out locally rather than refetched: the server has already
  // confirmed the delete, and a refetch would flicker the whole list.
  const drop = useCallback((id: string) => {
    setRecords((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    setNote("Feedback deleted.");
    if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 3000);
  }, []);

  // Don't leave the timer to fire into an unmounted page.
  useEffect(
    () => () => {
      if (noteTimer.current !== null) clearTimeout(noteTimer.current);
    },
    [],
  );

  const openCount = records?.filter((r) => r.status !== "incorporated").length ?? 0;

  return (
    <div className="wrap">
      <h1>All feedback</h1>
      <p className="lede">
        Everything testers have submitted, newest first. Open to everyone — scan it before filing
        something new so the same issue is not reported twice. Items marked{" "}
        <span className="chip chip-info">Incorporated</span> have been addressed and are waiting
        on a re-test.
      </p>

      <div className="panel">
        <div className="panel-head">
          <h2>Submissions</h2>
          <span className="spacer" />
          <span className="section-label" style={{ margin: 0 }}>
            {records ? `${records.length} total · ${openCount} open` : "loading"}
          </span>
          {note && <span className="fb-note">{note}</span>}
          <button className="btn-secondary fb-refresh" onClick={load} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="panel-body">
          {error ? (
            <div className="error-box">
              <strong>Could not load the feedback</strong>
              <p>{error}</p>
            </div>
          ) : records === null ? (
            <p className="no-findings">Loading…</p>
          ) : records.length === 0 ? (
            <p className="no-findings">
              No feedback yet. Use the Feedback button in the corner to add the first entry.
            </p>
          ) : (
            <ul className="fb-list">
              {records.map((r) => (
                <FeedbackItem key={r.id} record={r} onUpdated={replace} onDeleted={drop} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
